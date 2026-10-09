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
      under_review: 3,
      awaiting_seller: 1,
      awaiting_buyer: 0,
      resolved_refunded: 2,
      resolved_rejected: 4,
      closed: 1,
    });

    const response = await request(app)
      .get('/api/admin/disputes/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(11);
    expect(response.body.data.counts.under_review).toBe(3);
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
      .query({ status: 'under_review', limit: '10', cursor: 'cursor-1' });

    expect(response.status).toBe(200);
    expect(mockListDisputes).toHaveBeenCalledWith({
      status: 'under_review',
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

  it('records an admin status change with the authenticated actor', async () => {
    mockModerateDispute.mockResolvedValue({
      disputeId: 'dispute-1',
      status: 'awaiting_seller',
    });

    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'awaiting_seller', note: 'Contact the seller.' });

    expect(response.status).toBe(200);
    expect(mockModerateDispute).toHaveBeenCalledWith(
      'dispute-1',
      'admin-1',
      'awaiting_seller',
      'Contact the seller.',
    );
  });

  it('requires a note when rejecting a dispute', async () => {
    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved_rejected' });

    expect(response.status).toBe(400);
    expect(mockModerateDispute).not.toHaveBeenCalled();
  });

  it('does not allow marking a dispute refunded without a refund workflow', async () => {
    const response = await request(app)
      .patch('/api/admin/disputes/dispute-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved_refunded' });

    expect(response.status).toBe(400);
    expect(mockModerateDispute).not.toHaveBeenCalled();
  });
});