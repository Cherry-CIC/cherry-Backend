const StripeService = require('../../shared/config/stripeConfig');

export class PaymentRepository {
  /**
   * Creates a Stripe PaymentIntent for the given user.
   * Checks if a Stripe customer already exists for the provided email.
   * If found, reuses that customer; otherwise creates a new one.
   *
   * @param email - Customer email address.
   * @param amount - Amount in the smallest currency unit, pence for GBP.
   * @returns An object containing Stripe intent details, an ephemeral key, customer ID, and publishable key.
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

    // Create the PaymentIntent using GBP as default currency. The app sends
    // minor units, so do not add fees or convert pounds again here.
    const totalAmount = Number(amount);
    if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
      throw new Error('Amount must be a positive integer in the smallest currency unit');
    }

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
