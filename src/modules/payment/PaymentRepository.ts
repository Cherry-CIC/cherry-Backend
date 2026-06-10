const StripeService = require('../../shared/config/stripeConfig');

const DEFAULT_SECURITY_FEE_GBP = 2.0;
export const INVALID_PAYMENT_AMOUNT_ERROR =
  'Amount must be a positive finite number';

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
   * @param amount - Amount in GBP before the configured security fee.
   * @returns An object containing Stripe intent details, an ephemeral key, customer ID, and publishable key.
   */
  async createPaymentIntentForUser(
    email: string,
    amount: number
  ) {
    const amountGbp = Number(amount);
    if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
      throw new Error(INVALID_PAYMENT_AMOUNT_ERROR);
    }

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
    const baseAmountPence = Math.round(amountGbp * 100);
    const securityFeePence = getSecurityFeePence();
    const totalAmount = baseAmountPence + securityFeePence;
    const paymentIntent = await StripeService.createPaymentIntent(
      totalAmount,
      'gbp',
      customer.id
    );

    return {
      paymentIntentId: paymentIntent.id,
      paymentIntent: paymentIntent.client_secret,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }
}
