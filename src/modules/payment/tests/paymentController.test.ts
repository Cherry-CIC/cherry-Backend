const mockCreatePaymentIntentForUserByUid = jest.fn();

jest.mock('../services/PaymentService', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    createPaymentIntentForUserByUid: mockCreatePaymentIntentForUserByUid,
  })),
}));

jest.mock('../../../shared/config/stripeConfig', () => ({
  createWebhook: jest.fn(),
}));

import { createPaymentIntent } from '../controllers/paymentController';

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

  it('returns 403 when the buyer owns the product', async () => {
    mockCreatePaymentIntentForUserByUid.mockRejectedValue(
      new Error('You cannot buy your own listing'),
    );
    const req: any = {
      user: { uid: 'seller-1' },
      body: { productId: 'product-1' },
    };
    const res = createResponse();

    await createPaymentIntent(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Self-purchase is not allowed',
      }),
    );
  });
});
