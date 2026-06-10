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

  it.each([
    ['negative', -10],
    ['zero', 0],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('rejects an invalid %s amount before calling Stripe', async (_, amount) => {
    await expect(
      new PaymentRepository().createPaymentIntentForUser(
        'buyer@example.com',
        amount,
      ),
    ).rejects.toThrow('Amount must be a positive finite number');

    expect(mockCustomersList).not.toHaveBeenCalled();
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it('creates a new customer when no existing Stripe customer is found', async () => {
    mockCustomersList.mockResolvedValue({ data: [] });
    mockAddNewCustomer.mockResolvedValue({ id: 'cus_new' });

    await new PaymentRepository().createPaymentIntentForUser(
      'new@example.com',
      30,
    );

    expect(mockAddNewCustomer).toHaveBeenCalledWith('new@example.com');
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      3200,
      'gbp',
      'cus_new',
    );
  });

  it('creates a new customer when the customer lookup fails', async () => {
    mockCustomersList.mockRejectedValue(new Error('Stripe unavailable'));
    mockAddNewCustomer.mockResolvedValue({ id: 'cus_fallback' });

    await new PaymentRepository().createPaymentIntentForUser(
      'fallback@example.com',
      20,
    );

    expect(mockAddNewCustomer).toHaveBeenCalledWith('fallback@example.com');
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      2200,
      'gbp',
      'cus_fallback',
    );
  });

  it.each([
    ['non-numeric string', 'invalid'],
    ['Infinity', 'Infinity'],
    ['NaN string', 'NaN'],
    ['negative value', '-1'],
  ])('falls back to the default security fee when config is %s', async (_, invalidValue) => {
    process.env.STRIPE_PURCHASE_SECURITY_FEE_GBP = invalidValue;

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
