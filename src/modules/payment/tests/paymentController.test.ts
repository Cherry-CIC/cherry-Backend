const mockCreatePaymentIntentForUserByUid = jest.fn();

jest.mock('../services/PaymentService', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    createPaymentIntentForUserByUid: mockCreatePaymentIntentForUserByUid,
  })),
}));

jest.mock('../../../shared/config/stripeConfig', () => ({
  createWebhook: jest.fn(),
}));

jest.mock('../services/WebhookService', () => ({
  WebhookService: jest.fn(),
}));

jest.mock('../WebhookEventRepository', () => ({
  WebhookEventRepository: jest.fn(),
}));

import { createPaymentIntent } from '../controllers/paymentController';
import { INVALID_PAYMENT_AMOUNT_ERROR } from '../PaymentRepository';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('paymentController.createPaymentIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when the payment amount is invalid', async () => {
    mockCreatePaymentIntentForUserByUid.mockRejectedValue(
      new Error(INVALID_PAYMENT_AMOUNT_ERROR),
    );

    const req: any = {
      user: { uid: 'user-1' },
      body: { amount: 0 },
    };
    const res = createResponse();

    await createPaymentIntent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Invalid amount',
        error: INVALID_PAYMENT_AMOUNT_ERROR,
      }),
    );
  });
});
