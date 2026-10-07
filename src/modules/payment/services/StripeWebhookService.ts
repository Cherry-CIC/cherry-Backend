import Stripe from 'stripe';
import { stripe } from '../../../shared/config/stripeConfig';
import { PaymentRecordRepository } from '../repositories/PaymentRecordRepository';
import { PaymentRecordInput } from '../model/PaymentRecord';
import {
  CheckoutPaymentDetails,
  parseCheckoutPaymentIntent,
} from '../utils/checkoutPaymentIntent';

export type WebhookOutcome =
  | { action: 'ignored'; eventType: string }
  | {
      action: 'recorded';
      status: 'paid' | 'flagged';
      paymentIntentId: string;
      orderId: string | null;
      flagReason: string | null;
    };

interface ChargeDetails {
  chargeId: string | null;
  balanceTransactionId: string | null;
  chargedAt: Date | null;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

export class StripeWebhookService {
  constructor(
    private readonly paymentRecordRepo = new PaymentRecordRepository(),
  ) {}

  async handleEvent(event: Stripe.Event): Promise<WebhookOutcome> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.handlePaymentSucceeded(
          event,
          event.data.object as Stripe.PaymentIntent,
        );
      default:
        return { action: 'ignored', eventType: event.type };
    }
  }

  private async handlePaymentSucceeded(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<WebhookOutcome> {
    const { flagReason, pricing } = this.checkPayment(paymentIntent);
    const charge = await this.getChargeDetails(paymentIntent);
    const metadata = paymentIntent.metadata ?? {};

    const record: PaymentRecordInput = {
      paymentIntentId: paymentIntent.id,
      status: flagReason ? 'flagged' : 'paid',
      flagReason,
      firebaseUid: metadata.firebaseUid || null,
      productId: metadata.productId || null,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      productAmount: pricing?.productAmount ?? null,
      shippingFee: pricing?.shippingFee ?? null,
      securityFee: pricing?.securityFee ?? null,
      stripeChargeId: charge.chargeId,
      stripeBalanceTransactionId: charge.balanceTransactionId,
      paidAt: charge.chargedAt ?? new Date(event.created * 1000),
      lastStripeEventId: event.id,
    };

    if (flagReason) {
      console.warn(
        `Stripe payment ${paymentIntent.id} flagged for review: ${flagReason}`,
      );
    }

    const result = await this.paymentRecordRepo.recordPayment(record);

    return {
      action: 'recorded',
      status: result.keptExistingPaid ? 'paid' : record.status,
      paymentIntentId: paymentIntent.id,
      orderId: result.orderId,
      flagReason: result.keptExistingPaid ? null : flagReason,
    };
  }

  private checkPayment(paymentIntent: Stripe.PaymentIntent): {
    flagReason: string | null;
    pricing: CheckoutPaymentDetails | null;
  } {
    const flag = (flagReason: string) => ({ flagReason, pricing: null });

    if (paymentIntent.status !== 'succeeded') {
      return flag(`PaymentIntent status is ${paymentIntent.status}`);
    }
    if (paymentIntent.currency?.toLowerCase() !== 'gbp') {
      return flag('Payment currency must be GBP');
    }
    if (!paymentIntent.metadata?.firebaseUid) {
      return flag('Payment has no cherry buyer attached');
    }
    try {
      return {
        flagReason: null,
        pricing: parseCheckoutPaymentIntent(paymentIntent),
      };
    } catch (err) {
      return flag(
        err instanceof Error ? err.message : 'Invalid checkout metadata',
      );
    }
  }

  private async getChargeDetails(
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<ChargeDetails> {
    // Older Stripe API versions send `charges` instead of `latest_charge`
    const legacyCharges = (
      paymentIntent as unknown as { charges?: { data?: Stripe.Charge[] } }
    ).charges;
    const latestCharge =
      paymentIntent.latest_charge ?? legacyCharges?.data?.[0] ?? null;
    const chargeId = idOf(latestCharge);
    if (!chargeId) {
      return { chargeId: null, balanceTransactionId: null, chargedAt: null };
    }

    try {
      const charge =
        typeof latestCharge === 'string'
          ? await stripe.charges.retrieve(chargeId)
          : (latestCharge as Stripe.Charge);
      return {
        chargeId,
        balanceTransactionId: idOf(charge.balance_transaction),
        chargedAt: charge.created ? new Date(charge.created * 1000) : null,
      };
    } catch (err) {
      console.warn(
        `Could not load Stripe charge ${chargeId} for ${paymentIntent.id}:`,
        err instanceof Error ? err.message : err,
      );
      return { chargeId, balanceTransactionId: null, chargedAt: null };
    }
  }
}
