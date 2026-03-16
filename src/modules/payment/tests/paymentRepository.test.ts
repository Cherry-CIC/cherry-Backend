jest.mock('../../../shared/config/stripeConfig', () => ({
  getStripeClient: jest.fn().mockReturnValue({
    customers: {
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
  }),
  addNewCustomer: jest.fn().mockResolvedValue({ id: 'cus_123' }),
  createEphemeralKey: jest.fn().mockResolvedValue({ secret: 'eph_key' }),
  createPaymentIntent: jest.fn().mockResolvedValue({ client_secret: 'pi_secret' }),
  getStripePublishableKey: jest.fn().mockReturnValue('pk_test_123'),
}));

import { PaymentRepository } from '../PaymentRepository';
import {
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
} from '../../../shared/config/stripeConfig';

describe('PaymentRepository', () => {
  const originalFee = process.env.PAYMENT_SECURITY_FEE_BPS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_SECURITY_FEE_BPS = '1000';
  });

  afterAll(() => {
    process.env.PAYMENT_SECURITY_FEE_BPS = originalFee;
  });

  it('treats amount as pence and applies a 10% security fee', async () => {
    const repository = new PaymentRepository();

    const result = await repository.createPaymentIntentForUser(
      'buyer@example.com',
      1000,
    );

    expect(addNewCustomer).toHaveBeenCalledWith('buyer@example.com');
    expect(createEphemeralKey).toHaveBeenCalledWith('cus_123');
    expect(createPaymentIntent).toHaveBeenCalledWith(
      1100,
      'gbp',
      'cus_123',
      {
        subtotalAmount: '1000',
        securityFeeAmount: '100',
        securityFeeBasisPoints: '1000',
      },
    );
    expect(result).toEqual({
      paymentIntent: 'pi_secret',
      ephemeralKey: 'eph_key',
      customer: 'cus_123',
      publishableKey: 'pk_test_123',
      currency: 'gbp',
      subtotalAmount: 1000,
      securityFeeAmount: 100,
      totalAmount: 1100,
    });
  });
});
