import request from 'supertest';
import { admin } from '../../../shared/config/firebaseConfig';

jest.mock('../../../shared/config/swaggerConfig', () => ({
  swaggerSpecs: {},
}));

jest.mock('../../notifications/services/EmailService', () => ({
  EmailService: jest.fn(),
}));

jest.mock('../../notifications/services/NotificationService', () => ({
  NotificationService: jest.fn(),
}));

const mockGetStatusCounts = jest.fn();
const mockListDisputes = jest.fn();
const mockGetDisputeDetails = jest.fn();
const mockGetDisputeDetailsByOrderId = jest.fn();
const mockModerateDispute = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: jest.fn(),
    }),
    storage: jest.fn(),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

jest.mock('../../../disputes/DisputeRepository', () => ({
  DisputeRepository: jest.fn().mockImplementation(() => ({
    getStatusCounts: mockGetStatusCounts,
    listDisputes: mockListDisputes,
    getDisputeDetails: mockGetDisputeDetails,
    getDisputeDetailsByOrderId: mockGetDisputeDetailsByOrderId,
    moderateDispute: mockModerateDispute,
  })),
}));

import app from '../../../app';

describe('Admin dispute routes', () => {
  const userToken = 'regular-user-token';
  const adminToken = 'admin-user-token';

  beforeEach(() => {
    jest.clearAllMocks();
    (admin.auth().verifyIdToken as jest.Mock).mockImplementation(
      async (token: string) => {
        if (token === adminToken) {
          return { uid: 'admin-1', admin: true };
        }
        if (token === userToken) {
          return { uid: 'user-1', admin: false };
        }
        throw new Error('Invalid token');
      },
    );
  });

  it('requires an authenticated administrator', async () => {
    const response = await request(app).get('/api/admin/disputes/summary');

    expect(response.status).toBe(401);
    expect(mockGetStatusCounts).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-admin', async () => {
    const response = await request(app)
      .get('/api/admin/disputes')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(403);
    expect(mockListDisputes).not.toHaveBeenCalled();
  });

  it('returns dispute counts for the dashboard overview', async () => {
    mockGetStatusCounts.mockResolvedValue({
      raised: 3,
      in_progress: 0,
      resolved: 8,
    });

    const response = await request(app)
      .get('/api/admin/disputes/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(11);
    expect(response.body.data.counts.raised).toBe(3);
  });

  it('lists disputes with a status filter and cursor pagination', async () => {
    mockListDisputes.mockResolvedValue({
      disputes: [],
      nextCursor: null,
      hasMore: false,
    });

    const response = await request(app)
      .get('/api/admin/disputes')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ status: 'raised', limit: '10', cursor: 'cursor-1' });

    expect(response.status).toBe(200);
    expect(mockListDisputes).toHaveBeenCalledWith({
      status: 'raised',
      limit: 10,
      cursor: 'cursor-1',
    });
  });

  it('rejects an unsupported status filter', async () => {
    const response = await request(app)
      .get('/api/admin/disputes')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ status: 'not_a_status' });

    expect(response.status).toBe(400);
    expect(mockListDisputes).not.toHaveBeenCalled();
  });

  it('returns dispute detail and its audit history', async () => {
    mockGetDisputeDetails.mockResolvedValue({
      dispute: { disputeId: 'dispute-1', orderId: 'order-1' },
      events: [{ eventId: 'event-1', type: 'submitted' }],
    });

    const response = await request(app)
      .get('/api/admin/disputes/dispute-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(mockGetDisputeDetails).toHaveBeenCalledWith('dispute-1');
    expect(response.body.data.events).toHaveLength(1);
  });

  it('returns dispute detail and audit history by order ID', async () => {
    mockGetDisputeDetailsByOrderId.mockResolvedValue({
      dispute: { disputeId: 'dispute-1', orderId: 'order-1' },
      events: [{ eventId: 'event-1', type: 'submitted' }],
    });

    const response = await request(app)
      .get('/api/admin/disputes/by-order/order-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(mockGetDisputeDetailsByOrderId).toHaveBeenCalledWith('order-1');
    expect(response.body.data.dispute.disputeId).toBe('dispute-1');
    expect(response.body.data.events).toHaveLength(1);
  });

  it('returns 404 when no dispute is linked to the order ID', async () => {
    mockGetDisputeDetailsByOrderId.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/admin/disputes/by-order/order-without-dispute')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('records an admin status change with the authenticated actor', async () => {
    mockModerateDispute.mockResolvedValue({
      disputeId: 'dispute-1',
      status: 'resolved',
    });

    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'resolve-dispute-1')
      .send({ status: 'resolved', note: 'Decision recorded.' });

    expect(response.status).toBe(200);
    expect(mockModerateDispute).toHaveBeenCalledWith(
      'dispute-1',
      'admin-1',
      'resolved',
      'Decision recorded.',
      'resolve-dispute-1',
    );
  });

  it('allows an admin to mark a dispute in progress through the status endpoint', async () => {
    mockModerateDispute.mockResolvedValue({
      disputeId: 'dispute-1',
      assignedAdminId: 'admin-1',
      status: 'in_progress',
    });

    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'progress-dispute-1')
      .send({ status: 'in_progress' });

    expect(response.status).toBe(200);
    expect(mockModerateDispute).toHaveBeenCalledWith(
      'dispute-1',
      'admin-1',
      'in_progress',
      undefined,
      'progress-dispute-1',
    );
  });

  it('requires an idempotency key for status changes', async () => {
    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', note: 'Decision recorded.' });

    expect(response.status).toBe(400);
    expect(mockModerateDispute).not.toHaveBeenCalled();
  });

  it('returns conflict when an idempotency key is reused with a different request', async () => {
    const { DisputeAdminError } = jest.requireActual(
      '../../../disputes/Dispute',
    );
    mockModerateDispute.mockRejectedValue(
      new DisputeAdminError('idempotency_key_reused'),
    );

    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'resolve-dispute-1')
      .send({ status: 'resolved', note: 'Different decision.' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('different request');
  });

  it('requires an explanation when resolving a dispute', async () => {
    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved' });

    expect(response.status).toBe(400);
    expect(mockModerateDispute).not.toHaveBeenCalled();
  });

  it('rejects statuses outside the agreed dispute workflow', async () => {
    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'closed' });

    expect(response.status).toBe(400);
    expect(mockModerateDispute).not.toHaveBeenCalled();
  });
});
