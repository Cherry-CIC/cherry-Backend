import Stripe from 'stripe';

const StripeService = require('../../shared/config/stripeConfig');

export class PaymentRepository {
  /**
   * Creates a Stripe PaymentIntent for the given user.
   * Checks if a Stripe customer already exists for the provided email.
   * If found, reuses that customer; otherwise creates a new one.
   *
   * @param email - Customer email address.
   * @param amount - Amount in pence.
   * @returns An object containing the client secret, ephemeral key, customer ID, and publishable key.
   */
  async createPaymentIntentForUser(
    email: string,
    amount: number,
    firebaseUid?: string,
  ) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Amount must be a positive integer in pence');
    }

    // Attempt to find an existing customer by email
    const listResult = await StripeService.stripe.customers.list({
      email,
      limit: 1,
    });
    let customer = listResult.data?.[0];

    // If no existing customer, create a new one
    if (!customer) {
      customer = await StripeService.addNewCustomer(email);
    }

    // Create an Ephemeral Key (useful for mobile SDKs)
    const ephemeralKey = await StripeService.createEphemeralKey(customer.id);

    // Create the PaymentIntent using GBP. The frontend sends total pence.
    const paymentIntent = await StripeService.createPaymentIntent(
      amount,
      'gbp',
      customer.id,
      firebaseUid ? { firebaseUid } : undefined,
    );

    return {
      paymentIntent: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }

  async getPaymentIntent(
    paymentIntentId: string,
  ): Promise<Stripe.PaymentIntent> {
    return StripeService.retrievePaymentIntent(paymentIntentId);
  }

  async getCustomerEmail(customerId: string): Promise<string | undefined> {
    const customer = await StripeService.getCustomerByID(customerId);
    return customer.email || undefined;
  }
}
