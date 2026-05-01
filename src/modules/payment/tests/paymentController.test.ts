jest.mock('../../../shared/config/stripeConfig', () => ({
  createWebhook: jest.fn(),
}));
jest.mock('../../order/repositories/OrderRepository');
jest.mock('../services/PaymentService');

import { Request, Response } from 'express';
import { createWebhook } from '../../../shared/config/stripeConfig';
import {
  createPaymentIntent,
  stripeWebhook,
} from '../controllers/paymentController';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { PaymentService } from '../services/PaymentService';

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
          status: 'succeeded',
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
    expect(
      OrderRepository.prototype.updatePaymentStatusByPaymentIntentId,
    ).toHaveBeenCalledWith('pi_123', 'succeeded');
  });
});

describe('createPaymentIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the Stripe PaymentIntent ID for order creation', async () => {
    (
      PaymentService.prototype.createPaymentIntentForUserByUid as jest.Mock
    ).mockResolvedValue({
      paymentIntent: 'pi_123_secret_abc',
      paymentIntentId: 'pi_123',
      ephemeralKey: 'ek_123',
      customer: 'cus_123',
      amount: 1299,
      currency: 'gbp',
      publishableKey: 'pk_test_mock',
    });
    const request = {
      user: { uid: 'user-uid' },
      body: { amount: 1299 },
    } as unknown as Request;
    const response = makeResponse();

    await createPaymentIntent(request, response);

    expect(
      PaymentService.prototype.createPaymentIntentForUserByUid,
    ).toHaveBeenCalledWith('user-uid', 1299);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentIntentId: 'pi_123',
          amount: 1299,
          currency: 'gbp',
        }),
      }),
    );
  });

  it('rejects non-pence payment amounts', async () => {
    const request = {
      user: { uid: 'user-uid' },
      body: { amount: 12.99 },
    } as unknown as Request;
    const response = makeResponse();

    await createPaymentIntent(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(
      PaymentService.prototype.createPaymentIntentForUserByUid,
    ).not.toHaveBeenCalled();
  });
});
