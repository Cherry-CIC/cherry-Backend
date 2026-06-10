const mockCustomersList = jest.fn();
const mockAddNewCustomer = jest.fn();
const mockCreateEphemeralKey = jest.fn();
const mockCreatePaymentIntent = jest.fn();

jest.mock('../../../shared/config/stripeConfig', () => ({
  stripe: {
    customers: {
      list: mockCustomersList,
    },
  },
  addNewCustomer: mockAddNewCustomer,
  createEphemeralKey: mockCreateEphemeralKey,
  createPaymentIntent: mockCreatePaymentIntent,
}));

import { PaymentRepository } from '../PaymentRepository';

describe('PaymentRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';
    process.env.STRIPE_PURCHASE_SECURITY_FEE_GBP = '2.00';
    mockCustomersList.mockResolvedValue({
      data: [{ id: 'cus_existing' }],
    });
    mockCreateEphemeralKey.mockResolvedValue({
      secret: 'ek_test_123',
    });
    mockCreatePaymentIntent.mockResolvedValue({
      id: 'pi_123',
      client_secret: 'pi_123_secret_456',
    });
  });

  it('creates payment intents from a GBP amount, adds the security fee, and returns the Flutter client-secret alias', async () => {
    const result = await new PaymentRepository().createPaymentIntentForUser(
      'buyer@example.com',
      25.99,
    );

    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      2799,
      'gbp',
      'cus_existing',
    );
    expect(result).toEqual({
      paymentIntentId: 'pi_123',
      paymentIntent: 'pi_123_secret_456',
      clientSecret: 'pi_123_secret_456',
      ephemeralKey: 'ek_test_123',
      customer: 'cus_existing',
      publishableKey: 'pk_test_123',
    });
  });

  it('falls back to the default security fee when the configured fee is invalid', async () => {
    process.env.STRIPE_PURCHASE_SECURITY_FEE_GBP = '-1';

    await new PaymentRepository().createPaymentIntentForUser(
      'buyer@example.com',
      25,
    );

    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      2700,
      'gbp',
      'cus_existing',
    );
  });
});
