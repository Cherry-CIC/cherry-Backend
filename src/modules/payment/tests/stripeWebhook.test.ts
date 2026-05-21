// Mock all external dependencies BEFORE any imports that trigger module resolution.
// Each mock is scoped to exactly what the webhook pipeline uses.

// ── Stripe config ──────────────────────────────────────────────────────────────
const mockCreateWebhook = jest.fn();
jest.mock('../../../shared/config/stripeConfig', () => ({
  createWebhook: mockCreateWebhook,
}));

// ── WebhookEventRepository ─────────────────────────────────────────────────────
const mockHasBeenProcessed = jest.fn();
const mockMarkAsProcessed = jest.fn();
jest.mock('../WebhookEventRepository', () => ({
  WebhookEventRepository: jest.fn().mockImplementation(() => ({
    hasBeenProcessed: mockHasBeenProcessed,
    markAsProcessed: mockMarkAsProcessed,
  })),
}));

// ── WebhookService ─────────────────────────────────────────────────────────────
const mockHandleStripeEvent = jest.fn();
jest.mock('../services/WebhookService', () => ({
  WebhookService: jest.fn().mockImplementation(() => ({
    handleStripeEvent: mockHandleStripeEvent,
  })),
}));

// ── PaymentService (used only by createPaymentIntent, not the webhook) ─────────
jest.mock('../services/PaymentService', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({})),
}));

import { stripeWebhook } from '../controllers/paymentController';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Creates a minimal mock Express Response that records calls. */
const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

/** Builds a minimal mock Stripe event object for the given type. */
const buildStripeEvent = (
  type: string,
  paymentIntentId = 'pi_test_123'
): any => ({
  id: 'evt_test_001',
  type,
  data: {
    object: {
      id: paymentIntentId,
      object: 'payment_intent',
    },
  },
});

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('stripeWebhook controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Signature verification
  // ────────────────────────────────────────────────────────────────────────────

  describe('signature verification', () => {
    it('returns 400 when the stripe-signature header is absent', async () => {
      const req: any = {
        headers: {},          // no stripe-signature
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      // Idempotency and business logic must never be reached
      expect(mockHasBeenProcessed).not.toHaveBeenCalled();
      expect(mockHandleStripeEvent).not.toHaveBeenCalled();
    });

    it('returns 400 when the stripe signature is invalid', async () => {
      // Simulate Stripe's signature mismatch error
      mockCreateWebhook.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload.');
      });

      const req: any = {
        headers: { 'stripe-signature': 'bad_sig' },
        body: Buffer.from('{"type":"payment_intent.succeeded"}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      // Event must not be marked processed or acted upon
      expect(mockHasBeenProcessed).not.toHaveBeenCalled();
      expect(mockMarkAsProcessed).not.toHaveBeenCalled();
      expect(mockHandleStripeEvent).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Idempotency
  // ────────────────────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns 200 without processing a duplicate event', async () => {
      const event = buildStripeEvent('payment_intent.succeeded');
      mockCreateWebhook.mockReturnValue(event);
      // The event has already been stored in Firestore
      mockHasBeenProcessed.mockResolvedValue(true);

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // Business logic and Firestore write must NOT run
      expect(mockHandleStripeEvent).not.toHaveBeenCalled();
      expect(mockMarkAsProcessed).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // payment_intent.succeeded
  // ────────────────────────────────────────────────────────────────────────────

  describe('payment_intent.succeeded', () => {
    it('processes a valid succeeded event and returns 200', async () => {
      const event = buildStripeEvent('payment_intent.succeeded');
      mockCreateWebhook.mockReturnValue(event);
      mockHasBeenProcessed.mockResolvedValue(false);
      mockHandleStripeEvent.mockResolvedValue(undefined);
      mockMarkAsProcessed.mockResolvedValue(undefined);

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      // Verify the event was dispatched to the service
      expect(mockHandleStripeEvent).toHaveBeenCalledWith(event);
      // Verify it was marked as processed after successful handling
      expect(mockMarkAsProcessed).toHaveBeenCalledWith(event.id, event.type);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('does NOT mark event processed when handleStripeEvent throws', async () => {
      const event = buildStripeEvent('payment_intent.succeeded');
      mockCreateWebhook.mockReturnValue(event);
      mockHasBeenProcessed.mockResolvedValue(false);
      // Simulate an unexpected failure in business logic
      mockHandleStripeEvent.mockRejectedValue(new Error('Firestore write failed'));

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      // Must return 500 so Stripe retries
      expect(res.status).toHaveBeenCalledWith(500);
      // Must NOT persist the event ID — the event must be retryable
      expect(mockMarkAsProcessed).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // payment_intent.payment_failed
  // ────────────────────────────────────────────────────────────────────────────

  describe('payment_intent.payment_failed', () => {
    it('processes a payment_failed event and returns 200', async () => {
      const event = buildStripeEvent('payment_intent.payment_failed');
      mockCreateWebhook.mockReturnValue(event);
      mockHasBeenProcessed.mockResolvedValue(false);
      mockHandleStripeEvent.mockResolvedValue(undefined);
      mockMarkAsProcessed.mockResolvedValue(undefined);

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(mockHandleStripeEvent).toHaveBeenCalledWith(event);
      expect(mockMarkAsProcessed).toHaveBeenCalledWith(event.id, event.type);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // payment_intent.canceled
  // ────────────────────────────────────────────────────────────────────────────

  describe('payment_intent.canceled', () => {
    it('processes a canceled event and returns 200', async () => {
      const event = buildStripeEvent('payment_intent.canceled');
      mockCreateWebhook.mockReturnValue(event);
      mockHasBeenProcessed.mockResolvedValue(false);
      mockHandleStripeEvent.mockResolvedValue(undefined);
      mockMarkAsProcessed.mockResolvedValue(undefined);

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(mockHandleStripeEvent).toHaveBeenCalledWith(event);
      expect(mockMarkAsProcessed).toHaveBeenCalledWith(event.id, event.type);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Unsupported event types
  // ────────────────────────────────────────────────────────────────────────────

  describe('unsupported event types', () => {
    it('safely accepts and marks an unsupported event type without error', async () => {
      // WebhookService.handleStripeEvent logs unsupported types and returns normally.
      // The controller should not error out — Stripe must receive 200.
      const event = buildStripeEvent('customer.subscription.created');
      mockCreateWebhook.mockReturnValue(event);
      mockHasBeenProcessed.mockResolvedValue(false);
      // The real WebhookService would just log and return void for unknown types.
      mockHandleStripeEvent.mockResolvedValue(undefined);
      mockMarkAsProcessed.mockResolvedValue(undefined);

      const req: any = {
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();

      await stripeWebhook(req, res);

      expect(mockHandleStripeEvent).toHaveBeenCalledWith(event);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
