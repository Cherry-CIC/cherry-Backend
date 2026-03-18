jest.mock('../../../shared/config/stripeConfig', () => ({
  createWebhook: jest.fn(),
}));

import { Request, Response } from 'express';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { stripeWebhook } from '../controllers/paymentController';

const makeResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('stripeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when the Stripe signature header is missing', async () => {
    const request = {
      headers: {},
      body: {},
    } as unknown as Request;
    const response = makeResponse();

    await stripeWebhook(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when signature verification fails', async () => {
    (createWebhook as jest.Mock).mockImplementation(() => {
      const error = new Error('Signature invalid');
      error.name = 'StripeSignatureVerificationError';
      throw error;
    });

    const request = {
      headers: {
        'stripe-signature': 'bad-signature',
      },
      rawBody: Buffer.from('{}'),
      body: {},
    } as unknown as Request;
    const response = makeResponse();

    await stripeWebhook(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(createWebhook).toHaveBeenCalledWith(
      Buffer.from('{}'),
      'bad-signature',
    );
  });

  it('accepts valid raw webhook payloads', async () => {
    (createWebhook as jest.Mock).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
        },
      },
    });

    const request = {
      headers: {
        'stripe-signature': 'valid-signature',
      },
      rawBody: Buffer.from('{"id":"evt_123"}'),
      body: {},
    } as unknown as Request;
    const response = makeResponse();

    await stripeWebhook(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
  });
});
