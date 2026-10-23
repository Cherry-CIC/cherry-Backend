import Stripe from 'stripe';
import { stripe } from '../../../shared/config/stripeConfig';
import { PaymentRecordRepository } from '../repositories/PaymentRecordRepository';
import { PaymentRecordInput } from '../model/PaymentRecord';
import {
  CheckoutPaymentDetails,
  parseCheckoutPaymentIntent,
} from '../utils/checkoutPaymentIntent';
import { calculateFinancialBreakdown } from './financialBreakdown';
import { OrderRepository } from '../../order/repositories/OrderRepository';

export type WebhookOutcome =
  | { action: 'ignored'; eventType: string }
  | {
      action: 'payout_hold';
      change: 'placed' | 'cleared' | 'unchanged' | 'no_order';
      eventType: string;
      paymentIntentId: string | null;
      orderId: string | null;
    }
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
  stripeFee: number | null;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

export class StripeWebhookService {
  constructor(
    private readonly paymentRecordRepo = new PaymentRecordRepository(),
    private readonly orderRepo = new OrderRepository(),
  ) {}

  async handleEvent(event: Stripe.Event): Promise<WebhookOutcome> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.handlePaymentSucceeded(
          event,
          event.data.object as Stripe.PaymentIntent,
        );
      case 'charge.refunded':
        return this.placeHold(
          event,
          (event.data.object as Stripe.Charge).payment_intent,
          'refund',
        );
      case 'charge.dispute.created':
        return this.placeHold(
          event,
          (event.data.object as Stripe.Dispute).payment_intent,
          'chargeback',
        );
      case 'radar.early_fraud_warning.created':
        return this.placeHold(
          event,
          (event.data.object as { payment_intent?: string | null })
            .payment_intent,
          'fraud',
        );
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        // A lost chargeback stays on hold for an admin to decide.
        return dispute.status === 'won'
          ? this.clearHold(event, dispute.payment_intent, 'chargeback')
          : this.placeHold(event, dispute.payment_intent, 'chargeback');
      }
      default:
        return { action: 'ignored', eventType: event.type };
    }
  }

  private async placeHold(
    event: Stripe.Event,
    paymentIntent: string | { id: string } | null | undefined,
    reason: 'refund' | 'chargeback' | 'fraud',
  ): Promise<WebhookOutcome> {
    const paymentIntentId = idOf(paymentIntent);
    const orderId = paymentIntentId
      ? await this.orderRepo.getOrderIdByPaymentIntent(paymentIntentId)
      : null;
    if (!orderId) {
      console.warn(
        `Stripe ${event.type} (${event.id}) matches no order; no hold placed`,
      );
      return this.holdOutcome(event, 'no_order', paymentIntentId, null);
    }

    const result = await this.orderRepo.placePayoutHold(orderId, {
      reason,
      actorRole: 'stripe',
      stripeEventId: event.id,
    });
    return this.holdOutcome(
      event,
      result === 'placed' ? 'placed' : 'unchanged',
      paymentIntentId,
      orderId,
    );
  }

  private async clearHold(
    event: Stripe.Event,
    paymentIntent: string | { id: string } | null | undefined,
    reason: 'chargeback',
  ): Promise<WebhookOutcome> {
    const paymentIntentId = idOf(paymentIntent);
    const orderId = paymentIntentId
      ? await this.orderRepo.getOrderIdByPaymentIntent(paymentIntentId)
      : null;
    if (!orderId) {
      return this.holdOutcome(event, 'no_order', paymentIntentId, null);
    }

    const result = await this.orderRepo.clearPayoutHold(orderId, {
      reason,
      actorRole: 'stripe',
      stripeEventId: event.id,
    });
    if (result === 'cleared') {
      // The hold may have outlasted releaseAt, when no task is left to release.
      await this.orderRepo.releaseOrderForPayout(orderId, 'hold_expired');
    }
    return this.holdOutcome(event, result, paymentIntentId, orderId);
  }

  private holdOutcome(
    event: Stripe.Event,
    change: 'placed' | 'cleared' | 'unchanged' | 'no_order',
    paymentIntentId: string | null,
    orderId: string | null,
  ): WebhookOutcome {
    return {
      action: 'payout_hold',
      change,
      eventType: event.type,
      paymentIntentId,
      orderId,
    };
  }

  private async handlePaymentSucceeded(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<WebhookOutcome> {
    const { flagReason, pricing } = this.checkPayment(paymentIntent);
    const charge = await this.getChargeDetails(paymentIntent);
    const metadata = paymentIntent.metadata ?? {};
    const financialBreakdown = pricing
      ? calculateFinancialBreakdown({
          productAmount: pricing.productAmount,
          shippingFee: pricing.shippingFee,
          securityFee: pricing.securityFee,
          stripeFee: charge.stripeFee,
        })
      : null;

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
      charityProceeds: financialBreakdown?.charityProceeds ?? null,
      stripeFee: financialBreakdown?.stripeFee ?? null,
      cherryRevenue: financialBreakdown?.cherryRevenue ?? null,
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
      return {
        chargeId: null,
        balanceTransactionId: null,
        chargedAt: null,
        stripeFee: null,
      };
    }

    try {
      const charge =
        typeof latestCharge === 'string'
          ? await stripe.charges.retrieve(chargeId)
          : (latestCharge as Stripe.Charge);
      const balanceTransactionId = idOf(charge.balance_transaction);
      let stripeFee: number | null = null;
      if (
        charge.balance_transaction &&
        typeof charge.balance_transaction !== 'string'
      ) {
        stripeFee = this.readGbpStripeFee(charge.balance_transaction);
      } else if (balanceTransactionId) {
        try {
          const balanceTransaction =
            await stripe.balanceTransactions.retrieve(balanceTransactionId);
          stripeFee = this.readGbpStripeFee(balanceTransaction);
        } catch (err) {
          console.warn(
            `Could not load Stripe balance transaction ${balanceTransactionId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      return {
        chargeId,
        balanceTransactionId,
        chargedAt: charge.created ? new Date(charge.created * 1000) : null,
        stripeFee,
      };
    } catch (err) {
      console.warn(
        `Could not load Stripe charge ${chargeId} for ${paymentIntent.id}:`,
        err instanceof Error ? err.message : err,
      );
      return {
        chargeId,
        balanceTransactionId: null,
        chargedAt: null,
        stripeFee: null,
      };
    }
  }

  private readGbpStripeFee(
    balanceTransaction: Stripe.BalanceTransaction,
  ): number | null {
    if (balanceTransaction.currency.toLowerCase() !== 'gbp') {
      return null;
    }
    return Number.isInteger(balanceTransaction.fee) &&
      balanceTransaction.fee >= 0
      ? balanceTransaction.fee
      : null;
  }
}
