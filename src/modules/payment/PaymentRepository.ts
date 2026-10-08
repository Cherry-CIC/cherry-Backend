import { stripe } from '../../shared/config/stripeConfig';
import Stripe from 'stripe';

export class PaymentRepository {
  async createPaymentIntentForUser(
    email: string,
    totalAmount: number,
    metadata: Record<string, string>,
  ) {
    if (!metadata.firebaseUid || !metadata.checkoutSessionId)
      throw new Error('Verified checkout context is required');
    // Email is a contact attribute, never an ownership credential. A new Firebase
    // UID using the same address must not inherit an old customer's payment data.
    const candidates = await stripe.customers.list({ email, limit: 100 });
    let customer: Stripe.Customer | undefined = candidates.data.find(
      (entry) => entry.metadata.firebaseUid === metadata.firebaseUid,
    );
    if (!customer) {
      customer = await stripe.customers.create(
        {
          email,
          metadata: { firebaseUid: metadata.firebaseUid },
        },
        { idempotencyKey: `checkout:${metadata.checkoutSessionId}:customer` },
      );
    }
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalAmount,
        currency: 'gbp',
        customer: customer.id,
        metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `checkout:${metadata.checkoutSessionId}:payment` },
    );
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2022-08-01' },
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
