const StripeService = require('../../shared/config/stripeConfig');

const DEFAULT_SECURITY_FEE_GBP = 2.0;

const getSecurityFeePence = (): number => {
  const rawValue = process.env.STRIPE_PURCHASE_SECURITY_FEE_GBP;
  const feeGbp = rawValue ? Number(rawValue) : DEFAULT_SECURITY_FEE_GBP;

  if (!Number.isFinite(feeGbp) || feeGbp < 0) {
    return Math.round(DEFAULT_SECURITY_FEE_GBP * 100);
  }

  return Math.round(feeGbp * 100);
};

export class PaymentRepository {
  /**
   * Creates a Stripe PaymentIntent for the given user.
   * Checks if a Stripe customer already exists for the provided email.
   * If found, reuses that customer; otherwise creates a new one.
   *
   * @param email - Customer email address.
   * @param amount - Amount in pounds (e.g., 30 = £30).
   * @param currency - Currency code (e.g., usd).
   * @returns An object containing the client secret, ephemeral key, customer ID, and publishable key.
   */
  async createPaymentIntentForUser(
    email: string,
    amount: number
  ) {
    // Attempt to find an existing customer by email
    let customer: any;
    try {
      const listResult = await StripeService.stripe.customers.list({
        email,
        limit: 1,
      });
      if (listResult.data && listResult.data.length > 0) {
        customer = listResult.data[0];
      }
    } catch (err) {
      // If listing fails, fallback to creating a new customer
    }

    // If no existing customer, create a new one
    if (!customer) {
      customer = await StripeService.addNewCustomer(email);
    }

    // Create an Ephemeral Key (useful for mobile SDKs)
    const ephemeralKey = await StripeService.createEphemeralKey(customer.id);

    // Stripe expects amount in the smallest currency unit (pence for GBP).
    const baseAmountPence = Math.round(amount * 100);
    const securityFeePence = getSecurityFeePence();
    const totalAmount = baseAmountPence + securityFeePence;
    const paymentIntent = await StripeService.createPaymentIntent(
      totalAmount,
      'gbp',
      customer.id
    );

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }
}
