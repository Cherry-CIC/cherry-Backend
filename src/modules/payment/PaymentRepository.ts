import * as StripeService from '../../shared/config/stripeConfig';
import type Stripe from 'stripe';

export class PaymentRepository {
  /** Reuse a Stripe customer where possible; never create an intent yet. */
  async customerForEmail(email: string): Promise<string> {
    // Attempt to find an existing customer by email
    let customer: Stripe.Customer | undefined;
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

    return customer.id as string;
  }

  async createPaymentIntentForUser(
    customerId: string,
    totalAmount: number,
    metadata: Record<string, string>,
    idempotencyKey: string,
  ) {
    return StripeService.createPaymentIntent(
      totalAmount,
      'gbp',
      customerId,
      metadata,
      idempotencyKey,
    );
  }

  async clientResponse(
    customerId: string,
    paymentIntent: { id: string; client_secret: string | null },
  ) {
    const ephemeralKey = await StripeService.createEphemeralKey(customerId);
    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }
}
