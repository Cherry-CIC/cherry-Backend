import {
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  getStripeClient,
  getStripePublishableKey,
} from '../../shared/config/stripeConfig';

export class PaymentRepository {
  private getSecurityFeeBasisPoints(): number {
    const rawValue = process.env.PAYMENT_SECURITY_FEE_BPS || '1000';
    const feeBasisPoints = Number.parseInt(rawValue, 10);

    if (!Number.isInteger(feeBasisPoints) || feeBasisPoints < 0) {
      throw new Error('PAYMENT_SECURITY_FEE_BPS must be a whole number of basis points.');
    }

    return feeBasisPoints;
  }

  /**
   * Creates a Stripe PaymentIntent for the given user.
   * Checks if a Stripe customer already exists for the provided email.
   * If found, reuses that customer; otherwise creates a new one.
   *
   * @param email - Customer email address.
   * @param amount - Item subtotal in pence.
   * @returns An object containing the client secret, ephemeral key, customer ID, and publishable key.
   */
  async createPaymentIntentForUser(email: string, amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Amount must be a positive integer in pence.');
    }

    const stripe = getStripeClient();
    const securityFeeBasisPoints = this.getSecurityFeeBasisPoints();
    const securityFeeAmount = Math.round((amount * securityFeeBasisPoints) / 10000);
    const totalAmount = amount + securityFeeAmount;

    // Attempt to find an existing customer by email
    let customer: any;
    try {
      const listResult = await stripe.customers.list({
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
      customer = await addNewCustomer(email);
    }

    // Create an Ephemeral Key (useful for mobile SDKs)
    const ephemeralKey = await createEphemeralKey(customer.id);

    // Create the PaymentIntent using GBP as default currency.
    const paymentIntent = await createPaymentIntent(
      totalAmount,
      'gbp',
      customer.id,
      {
        subtotalAmount: String(amount),
        securityFeeAmount: String(securityFeeAmount),
        securityFeeBasisPoints: String(securityFeeBasisPoints),
      },
    );

    return {
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: getStripePublishableKey(),
      currency: 'gbp',
      subtotalAmount: amount,
      securityFeeAmount,
      totalAmount,
    };
  }
}
