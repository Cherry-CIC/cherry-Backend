// Verifies the real WebhookService against a mocked OrderRepository. These
// tests pin the order-state guarantees that protect Cherry's payment integrity:
//
//   - succeeded orders are NEVER overwritten by a later failed/canceled event
//   - processing only moves pending → processing (never rolls back a terminal)
//   - missing orders are a no-op (webhook may arrive before client createOrder)
//   - succeeded is idempotent (re-running a succeeded handler does nothing)
//   - no handler creates an order — webhooks are reconciliation only
//
// If any of these assertions break, payment state can corrupt silently. Every
// rule has at least one positive case (update happens) and one negative case
// (update is suppressed).

const mockGetOrderByPaymentIntentId = jest.fn();
const mockUpdateOrder = jest.fn();
const mockCreateOrder = jest.fn();

jest.mock('../../order/repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    getOrderByPaymentIntentId: mockGetOrderByPaymentIntentId,
    updateOrder: mockUpdateOrder,
    createOrder: mockCreateOrder,
  })),
}));

import { WebhookService } from '../services/WebhookService';

const buildEvent = (type: string, paymentIntentId = 'pi_test_123'): any => ({
  id: `evt_${type.replace(/\./g, '_')}`,
  type,
  data: { object: { id: paymentIntentId, object: 'payment_intent' } },
});

const buildOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'order_123',
  userId: 'user_1',
  amount: 2599,
  paymentIntentId: 'pi_test_123',
  paymentStatus: 'pending',
  shipmentStatus: 'not_created',
  deliveryType: 'pickup_point',
  shippingOptionId: '1',
  shippingWeight: 0,
  shipping: { address: {}, name: '' },
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookService();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Shared invariant across every handler: NEVER create an order from a webhook
  // ──────────────────────────────────────────────────────────────────────────

  describe('invariant — webhooks never create orders', () => {
    it.each([
      ['payment_intent.succeeded'],
      ['payment_intent.processing'],
      ['payment_intent.payment_failed'],
      ['payment_intent.canceled'],
    ])(
      '%s never calls createOrder, even when no order exists',
      async (type) => {
        mockGetOrderByPaymentIntentId.mockResolvedValue(null);

        await service.handleStripeEvent(buildEvent(type));

        expect(mockCreateOrder).not.toHaveBeenCalled();
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // payment_intent.succeeded
  // ──────────────────────────────────────────────────────────────────────────

  describe('payment_intent.succeeded', () => {
    it('updates a pending order to succeeded/completed', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'pending' }),
      );
      mockUpdateOrder.mockResolvedValue(undefined);

      await service.handleStripeEvent(buildEvent('payment_intent.succeeded'));

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'succeeded',
        status: 'completed',
      });
    });

    it('updates a processing order to succeeded/completed', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'processing' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.succeeded'));

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'succeeded',
        status: 'completed',
      });
    });

    it('is a no-op when the order is already succeeded (idempotent)', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'succeeded' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.succeeded'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('is a no-op when no order exists for the paymentIntent', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(null);

      await service.handleStripeEvent(buildEvent('payment_intent.succeeded'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // payment_intent.processing
  // ──────────────────────────────────────────────────────────────────────────

  describe('payment_intent.processing', () => {
    it('moves a pending order to processing', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'pending' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.processing'));

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'processing',
      });
    });

    it('NEVER rolls back a succeeded order to processing', async () => {
      // This is the most important guarantee in this handler. A late-arriving
      // processing event must not corrupt a captured payment.
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'succeeded' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.processing'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('NEVER rolls back a failed order to processing', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'failed' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.processing'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('is a no-op when no order exists', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(null);

      await service.handleStripeEvent(buildEvent('payment_intent.processing'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('does not touch shipmentStatus (no fulfilment side effects)', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'pending' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.processing'));

      const update = mockUpdateOrder.mock.calls[0][1];
      expect(update).not.toHaveProperty('shipmentStatus');
      expect(update).not.toHaveProperty('status');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // payment_intent.payment_failed
  // ──────────────────────────────────────────────────────────────────────────

  describe('payment_intent.payment_failed', () => {
    it('marks a pending order as failed', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'pending' }),
      );

      await service.handleStripeEvent(
        buildEvent('payment_intent.payment_failed'),
      );

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'failed',
        status: 'failed',
      });
    });

    it('marks a processing order as failed', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'processing' }),
      );

      await service.handleStripeEvent(
        buildEvent('payment_intent.payment_failed'),
      );

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'failed',
        status: 'failed',
      });
    });

    it('NEVER overwrites a succeeded order with failed', async () => {
      // Defensive: out-of-order Stripe deliveries must not destroy successful
      // payment state. The handler must log loudly and return without writing.
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'succeeded' }),
      );

      await service.handleStripeEvent(
        buildEvent('payment_intent.payment_failed'),
      );

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('is a no-op when no order exists', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(null);

      await service.handleStripeEvent(
        buildEvent('payment_intent.payment_failed'),
      );

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // payment_intent.canceled
  // ──────────────────────────────────────────────────────────────────────────

  describe('payment_intent.canceled', () => {
    it('marks a pending order as failed', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'pending' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.canceled'));

      expect(mockUpdateOrder).toHaveBeenCalledWith('order_123', {
        paymentStatus: 'failed',
        status: 'failed',
      });
    });

    it('NEVER overwrites a succeeded order with canceled', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(
        buildOrder({ paymentStatus: 'succeeded' }),
      );

      await service.handleStripeEvent(buildEvent('payment_intent.canceled'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });

    it('is a no-op when no order exists', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(null);

      await service.handleStripeEvent(buildEvent('payment_intent.canceled'));

      expect(mockUpdateOrder).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Unsupported / unknown event types
  // ──────────────────────────────────────────────────────────────────────────

  describe('unsupported event types', () => {
    it('returns without error and does not touch the order repository', async () => {
      // Must not throw — Stripe needs a 2xx so it stops retrying. And must not
      // accidentally read or write any order data.
      await expect(
        service.handleStripeEvent(buildEvent('customer.subscription.created')),
      ).resolves.toBeUndefined();

      expect(mockGetOrderByPaymentIntentId).not.toHaveBeenCalled();
      expect(mockUpdateOrder).not.toHaveBeenCalled();
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Lookup contract
  // ──────────────────────────────────────────────────────────────────────────

  describe('lookup', () => {
    it('looks up the order by the paymentIntent.id from the event payload', async () => {
      mockGetOrderByPaymentIntentId.mockResolvedValue(null);

      await service.handleStripeEvent(
        buildEvent('payment_intent.succeeded', 'pi_custom_999'),
      );

      expect(mockGetOrderByPaymentIntentId).toHaveBeenCalledWith(
        'pi_custom_999',
      );
    });
  });
});
