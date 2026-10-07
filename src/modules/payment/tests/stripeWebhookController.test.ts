// Signs payloads with the real Stripe library; no network calls are made.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

const mockHandleEvent = jest.fn();

jest.mock('../services/StripeWebhookService', () => ({
  StripeWebhookService: jest.fn().mockImplementation(() => ({
    handleEvent: mockHandleEvent,
  })),
}));

jest.mock('../services/PaymentService', () => ({
  PaymentService: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import { stripe } from '../../../shared/config/stripeConfig';
import { stripeWebhook } from '../controllers/paymentController';

// Mounted the same way as in app.ts
const app = express();
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook,
);

const payload = JSON.stringify({
  id: 'evt_test_1',
  object: 'event',
  type: 'payment_intent.succeeded',
  created: 1_791_000_000,
  data: { object: { id: 'pi_test_1', object: 'payment_intent' } },
});

const sign = (body: string, secret = 'whsec_test_secret') =>
  stripe.webhooks.generateTestHeaderString({ payload: body, secret });

const post = (body: string, signature?: string) => {
  const req = request(app)
    .post('/api/payment/webhook')
    .set('Content-Type', 'application/json');
  return (signature ? req.set('Stripe-Signature', signature) : req).send(body);
};

describe('stripeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandleEvent.mockResolvedValue({ action: 'ignored' });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('accepts a correctly signed event', async () => {
    const res = await post(payload, sign(payload));

    expect(res.status).toBe(200);
    expect(mockHandleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_test_1' }),
    );
  });

  it('rejects an event whose body was changed after signing', async () => {
    const tampered = payload.replace('pi_test_1', 'pi_attacker');

    const res = await post(tampered, sign(payload));

    expect(res.status).toBe(400);
    expect(mockHandleEvent).not.toHaveBeenCalled();
  });

  it('rejects an event signed with a different secret', async () => {
    const res = await post(payload, sign(payload, 'whsec_someone_else'));

    expect(res.status).toBe(400);
    expect(mockHandleEvent).not.toHaveBeenCalled();
  });

  it('rejects an event with no signature', async () => {
    const res = await post(payload);

    expect(res.status).toBe(400);
    expect(mockHandleEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when processing fails so Stripe retries', async () => {
    mockHandleEvent.mockRejectedValue(new Error('Firestore unavailable'));

    const res = await post(payload, sign(payload));

    expect(res.status).toBe(500);
  });
});
