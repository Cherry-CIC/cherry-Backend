import {
  stripe,
  addNewCustomer,
  createEphemeralKey,
} from '../../shared/config/stripeConfig';
import { ListingSafetyError } from '../../shared/utils/listingSafety';

export class PaymentRepository {
  async getOrCreateCustomerId(email: string): Promise<string> {
    const customers = await stripe.customers.list({ email, limit: 1 });
    return customers.data[0]?.id ?? (await addNewCustomer(email)).id;
  }

  /** All creation arguments come from the durable pending order. */
  async createPaymentIntentForUser(
    totalAmount: number,
    metadata: Record<string, string>,
    customerId: string,
    existingPaymentIntentId?: string,
  ) {
    const paymentIntent = existingPaymentIntentId
      ? await stripe.paymentIntents.retrieve(existingPaymentIntentId)
      : await stripe.paymentIntents.create(
          {
            amount: totalAmount,
            currency: 'gbp',
            customer: customerId,
            metadata,
            capture_method: 'automatic',
            automatic_payment_methods: { enabled: true },
          },
          { idempotencyKey: `checkout-order-${metadata.orderId}` },
        );
    const actualCustomer =
      typeof paymentIntent.customer === 'string'
        ? paymentIntent.customer
        : paymentIntent.customer?.id;
    if (
      paymentIntent.amount !== totalAmount ||
      paymentIntent.currency !== 'gbp' ||
      actualCustomer !== customerId ||
      Object.entries(metadata).some(
        ([key, value]) => paymentIntent.metadata[key] !== value,
      )
    ) {
      throw new ListingSafetyError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'The existing payment needs review before checkout can continue.',
      );
    }
    const ephemeralKey = await createEphemeralKey(customerId);
    return {
      paymentIntentId: paymentIntent.id,
      paymentStatus: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    };
  }
}
