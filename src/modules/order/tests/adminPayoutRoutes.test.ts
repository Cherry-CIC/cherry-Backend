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

const mockGetOrderById = jest.fn();
const mockGetPayoutEvents = jest.fn();
const mockPlacePayoutHold = jest.fn();
const mockClearPayoutHold = jest.fn();
const mockReleaseOrderForPayout = jest.fn();
const mockReconcile = jest.fn();

jest.mock('../services/OrderReleaseReconciliationService', () => ({
  ...jest.requireActual('../services/OrderReleaseReconciliationService'),
  OrderReleaseReconciliationService: jest.fn().mockImplementation(() => ({
    reconcile: mockReconcile,
  })),
}));

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

jest.mock('../repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    getOrderById: mockGetOrderById,
    getPayoutEvents: mockGetPayoutEvents,
    placePayoutHold: mockPlacePayoutHold,
    clearPayoutHold: mockClearPayoutHold,
    releaseOrderForPayout: mockReleaseOrderForPayout,
  })),
  FulfillmentJobBusyError: class FulfillmentJobBusyError extends Error {},
  PaymentOrderMismatchError: class PaymentOrderMismatchError extends Error {},
  PendingOrderUnavailableError: class PendingOrderUnavailableError extends Error {},
}));

import app from '../../../app';

describe('Admin order payout routes', () => {
  const userToken = 'regular-user-token';
  const adminToken = 'admin-user-token';
  const authorized = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);

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
    mockPlacePayoutHold.mockResolvedValue('placed');
    mockClearPayoutHold.mockResolvedValue('cleared');
    mockReleaseOrderForPayout.mockResolvedValue({ status: 'released' });
  });

  it.each([
    ['get', '/api/admin/orders/order-1/payout'],
    ['post', '/api/admin/orders/order-1/payout/hold'],
    ['post', '/api/admin/orders/order-1/payout/unhold'],
    ['post', '/api/admin/orders/order-1/payout/release'],
  ] as const)('requires an administrator for %s %s', async (method, path) => {
    const anonymous = await request(app)[method](path);
    const regular = await request(app)
      [method](path)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ note: 'x' });

    expect(anonymous.status).toBe(401);
    expect(regular.status).toBe(403);
    expect(mockPlacePayoutHold).not.toHaveBeenCalled();
    expect(mockClearPayoutHold).not.toHaveBeenCalled();
    expect(mockReleaseOrderForPayout).not.toHaveBeenCalled();
  });

  it('returns the payout state with its audit history', async () => {
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      payoutStatus: 'held',
      payoutHoldReason: 'refund',
      releaseAt: new Date('2026-10-22T10:00:00.000Z'),
    });
    mockGetPayoutEvents.mockResolvedValue([{ eventId: 'e1', type: 'hold_placed' }]);

    const res = await authorized(
      request(app).get('/api/admin/orders/order-1/payout'),
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      orderId: 'order-1',
      payoutStatus: 'held',
      payoutHoldReason: 'refund',
      deliveredAt: null,
      events: [{ eventId: 'e1', type: 'hold_placed' }],
    });
  });

  it('returns 404 for an unknown order', async () => {
    mockGetOrderById.mockResolvedValue(null);

    const res = await authorized(
      request(app).get('/api/admin/orders/missing/payout'),
    );

    expect(res.status).toBe(404);
  });

  describe('reconcile', () => {
    const summary = {
      scanned: 4,
      released: 2,
      alreadyReleased: 0,
      blocked: 1,
      tasksScheduled: 1,
      errors: 0,
    };

    it('runs the reconciliation with the requested limit', async () => {
      mockReconcile.mockResolvedValue(summary);

      const res = await authorized(
        request(app).post('/api/admin/payouts/reconcile'),
      ).send({ limit: 25 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(summary);
      expect(mockReconcile).toHaveBeenCalledWith(expect.any(Date), 25);
    });

    it('uses the default limit when none is given', async () => {
      mockReconcile.mockResolvedValue(summary);

      await authorized(request(app).post('/api/admin/payouts/reconcile')).send(
        {},
      );

      expect(mockReconcile).toHaveBeenCalledWith(expect.any(Date), 200);
    });

    it.each([0, -5, 1.5, 5000, 'many'])('rejects limit %p', async (limit) => {
      const res = await authorized(
        request(app).post('/api/admin/payouts/reconcile'),
      ).send({ limit });

      expect(res.status).toBe(400);
      expect(mockReconcile).not.toHaveBeenCalled();
    });

    it('requires an administrator', async () => {
      const res = await request(app)
        .post('/api/admin/payouts/reconcile')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(mockReconcile).not.toHaveBeenCalled();
    });
  });

  describe('hold', () => {
    const post = (path: string, body: unknown) =>
      authorized(request(app).post(`/api/admin/orders/order-1/payout/${path}`)).send(
        body as object,
      );

    it('places an admin hold attributed to the admin', async () => {
      const res = await post('hold', { note: 'Seller under review' });

      expect(res.status).toBe(200);
      expect(mockPlacePayoutHold).toHaveBeenCalledWith('order-1', {
        reason: 'admin',
        actorRole: 'admin',
        actorId: 'admin-1',
        note: 'Seller under review',
      });
    });

    it.each([{}, { note: '   ' }, { note: 'x'.repeat(2001) }])(
      'requires a valid note (%#)',
      async (body) => {
        const res = await post('hold', body);

        expect(res.status).toBe(400);
        expect(mockPlacePayoutHold).not.toHaveBeenCalled();
      },
    );

    it('rejects an order with no payout state', async () => {
      mockPlacePayoutHold.mockResolvedValue('not_applicable');

      expect((await post('hold', { note: 'Review' })).status).toBe(409);
    });
  });

  describe('unhold', () => {
    const post = (body: unknown) =>
      authorized(
        request(app).post('/api/admin/orders/order-1/payout/unhold'),
      ).send(body as object);

    it('removes an admin hold and then tries the release', async () => {
      mockReleaseOrderForPayout.mockResolvedValue({
        status: 'blocked',
        reason: 'not_due',
      });

      const res = await post({ note: 'Review finished' });

      expect(res.status).toBe(200);
      expect(mockClearPayoutHold).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ reason: 'admin', actorId: 'admin-1' }),
      );
      expect(mockReleaseOrderForPayout).toHaveBeenCalledWith(
        'order-1',
        'hold_expired',
      );
      expect(res.body.data.release).toEqual({
        status: 'blocked',
        reason: 'not_due',
      });
    });

    it('rejects an order with no admin hold without releasing it', async () => {
      mockClearPayoutHold.mockResolvedValue('unchanged');

      const res = await post({ note: 'Review finished' });

      expect(res.status).toBe(409);
      expect(mockReleaseOrderForPayout).not.toHaveBeenCalled();
    });
  });

  describe('release override', () => {
    const post = (body: unknown) =>
      authorized(
        request(app).post('/api/admin/orders/order-1/payout/release'),
      ).send(body as object);

    it('releases with the admin override trigger and records who and why', async () => {
      const res = await post({ note: 'Chargeback resolved offline' });

      expect(res.status).toBe(200);
      expect(mockReleaseOrderForPayout).toHaveBeenCalledWith(
        'order-1',
        'admin_override',
        expect.any(Date),
        { adminId: 'admin-1', note: 'Chargeback resolved offline' },
      );
    });

    it('requires a note', async () => {
      expect((await post({})).status).toBe(400);
      expect(mockReleaseOrderForPayout).not.toHaveBeenCalled();
    });

    it('reports a blocked release as a conflict', async () => {
      mockReleaseOrderForPayout.mockResolvedValue({
        status: 'blocked',
        reason: 'dispute_open',
      });

      const res = await post({ note: 'Override' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('dispute_open');
    });

    it('returns 404 for an unknown order', async () => {
      mockReleaseOrderForPayout.mockResolvedValue({
        status: 'blocked',
        reason: 'order_not_found',
      });

      expect((await post({ note: 'Override' })).status).toBe(404);
    });

    it('is idempotent for an order that is already released', async () => {
      mockReleaseOrderForPayout.mockResolvedValue({ status: 'already_released' });

      expect((await post({ note: 'Override' })).status).toBe(200);
    });
  });
});
