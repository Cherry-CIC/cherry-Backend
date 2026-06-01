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

  it('creates payment intents using the supplied minor-unit amount without converting pounds again', async () => {
    const result = await new PaymentRepository().createPaymentIntentForUser(
      'buyer@example.com',
      2599,
    );

    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      2599,
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
      amount: 2599,
      currency: 'gbp',
    });
  });

  it('rejects invalid payment amounts before calling Stripe', async () => {
    await expect(
      new PaymentRepository().createPaymentIntentForUser('buyer@example.com', 0),
    ).rejects.toThrow(
      'Amount must be a positive integer in the smallest currency unit',
    );

    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });
});
