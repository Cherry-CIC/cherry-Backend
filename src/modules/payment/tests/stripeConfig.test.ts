const mockCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockCreate },
  })),
);

describe('stripeConfig.createPaymentIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  });

  it('captures synchronously so the Stripe fee is available at order creation', async () => {
    mockCreate.mockResolvedValue({ id: 'pi_123' });
    const { createPaymentIntent } =
      await import('../../../shared/config/stripeConfig');

    await createPaymentIntent(2599, 'gbp', 'cus_123', { productId: 'p-1' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2599,
        currency: 'gbp',
        customer: 'cus_123',
        capture_method: 'automatic',
      }),
    );
  });
});
