import Stripe from 'stripe';
import { OrderRepository } from '../order/repositories/OrderRepository';

/**
 * Implements idempotent, safe business logic for each subscribed Stripe payment
 * event type. All methods are designed to be called at most once per event ID
 * (idempotency is enforced at the controller layer via WebhookEventRepository).
 *
 * Design contract:
 *   - This service NEVER creates orders. Orders are created exclusively by the
 *     client via POST /api/order/create after confirming payment. The webhook
 *     is for reconciliation and state correction only.
 *   - Every handler must be safe to run even when no matching order exists in
 *     Firestore (Stripe may deliver an event before the client has called the
 *     order endpoint). In that case, the handler logs and returns without error.
 *   - Partial order updates use updateOrder with only the fields that must change,
 *     so no other fields are touched.
 */
export class WebhookService {
  private orderRepo = new OrderRepository();

  /**
   * Routes a verified, non-duplicate Stripe event to the appropriate handler.
   * Unsupported event types are logged and silently ignored — they do not
   * cause an error so Stripe receives a 200 and stops retrying.
   */
  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(paymentIntent);
        break;

      case 'payment_intent.processing':
        await this.handlePaymentProcessing(paymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(paymentIntent);
        break;

      case 'payment_intent.canceled':
        await this.handlePaymentCanceled(paymentIntent);
        break;

      default:
        // Unsupported event types are not an error — they are intentionally
        // ignored. Returning normally ensures Stripe receives 200 and does not
        // retry. New event types should be added here when subscribed in Stripe.
        console.log(
          `[WebhookService] Unsupported event type received and safely ignored: ${event.type} (id: ${event.id})`
        );
        break;
    }
  }

  /**
   * payment_intent.succeeded
   *
   * The payment has been captured. If an order for this PaymentIntent exists and
   * its paymentStatus is not already 'succeeded', update it to 'succeeded'.
   *
   * Safe behaviour:
   *   - No-op if the order does not exist yet (client has not called /api/order).
   *   - No-op if paymentStatus is already 'succeeded' (prevents double-processing
   *     on Stripe retries, even if the idempotency check in the controller is
   *     bypassed or the event is reprocessed for any reason).
   *   - Does NOT create or delete any order.
   */
  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(
      `[WebhookService] payment_intent.succeeded — paymentIntentId: ${paymentIntent.id}`
    );

    const order = await this.orderRepo.getOrderByPaymentIntentId(paymentIntent.id);

    if (!order) {
      // This is expected when the webhook fires before the client creates the order.
      // The order controller already verifies payment status before creating the order,
      // so this is safe to ignore.
      console.log(
        `[WebhookService] payment_intent.succeeded — no order found for paymentIntentId: ${paymentIntent.id}. No action taken.`
      );
      return;
    }

    if (order.paymentStatus === 'succeeded') {
      console.log(
        `[WebhookService] payment_intent.succeeded — order ${order.id} already marked succeeded. No action taken.`
      );
      return;
    }

    await this.orderRepo.updateOrder(order.id, {
      paymentStatus: 'succeeded',
      status: 'completed',
    });

    console.log(
      `[WebhookService] payment_intent.succeeded — order ${order.id} updated to paymentStatus: succeeded.`
    );
  }

  /**
   * payment_intent.processing
   *
   * Stripe is processing the payment (e.g. bank transfer, delayed settlement).
   * The outcome is not yet known. This MUST NOT mark the order as complete.
   *
   * Safe behaviour:
   *   - No-op if no order exists for this PaymentIntent.
   *   - Updates paymentStatus to 'processing' only if the order is currently
   *     'pending' — prevents rolling back a 'succeeded' or 'failed' order.
   *   - Does NOT create or fulfil any order.
   */
  private async handlePaymentProcessing(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(
      `[WebhookService] payment_intent.processing — paymentIntentId: ${paymentIntent.id}`
    );

    const order = await this.orderRepo.getOrderByPaymentIntentId(paymentIntent.id);

    if (!order) {
      console.log(
        `[WebhookService] payment_intent.processing — no order found for paymentIntentId: ${paymentIntent.id}. No action taken.`
      );
      return;
    }

    if (order.paymentStatus !== 'pending') {
      // Do not overwrite a terminal or already-advanced state with 'processing'.
      console.log(
        `[WebhookService] payment_intent.processing — order ${order.id} has paymentStatus '${order.paymentStatus}', not overwriting with 'processing'.`
      );
      return;
    }

    await this.orderRepo.updateOrder(order.id, {
      paymentStatus: 'processing',
    });

    console.log(
      `[WebhookService] payment_intent.processing — order ${order.id} updated to paymentStatus: processing.`
    );
  }

  /**
   * payment_intent.payment_failed
   *
   * The payment attempt has failed. The user may retry with a new PaymentIntent.
   *
   * Safe behaviour:
   *   - No-op if no order exists (the client should not have created one yet for
   *     a failed payment, but we guard defensively).
   *   - Updates order to paymentStatus: 'failed', status: 'failed' only if the
   *     order is not already in a terminal succeeded state.
   *   - Does NOT delete, refund, or create any record.
   */
  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(
      `[WebhookService] payment_intent.payment_failed — paymentIntentId: ${paymentIntent.id}`
    );

    const order = await this.orderRepo.getOrderByPaymentIntentId(paymentIntent.id);

    if (!order) {
      console.log(
        `[WebhookService] payment_intent.payment_failed — no order found for paymentIntentId: ${paymentIntent.id}. No action taken.`
      );
      return;
    }

    if (order.paymentStatus === 'succeeded') {
      // Defensive guard: do not overwrite a succeeded order with failed.
      // This should not occur in normal Stripe flows but prevents data corruption
      // if events arrive severely out-of-order.
      console.warn(
        `[WebhookService] payment_intent.payment_failed — order ${order.id} is already succeeded. Not overwriting. Manual review recommended.`
      );
      return;
    }

    await this.orderRepo.updateOrder(order.id, {
      paymentStatus: 'failed',
      status: 'failed',
    });

    console.log(
      `[WebhookService] payment_intent.payment_failed — order ${order.id} updated to paymentStatus: failed.`
    );
  }

  /**
   * payment_intent.canceled
   *
   * The PaymentIntent was canceled (by the server, the client, or Stripe).
   * Treat the same as a failed payment for order state purposes.
   *
   * Safe behaviour:
   *   - No-op if no order exists.
   *   - Updates order to paymentStatus: 'failed', status: 'failed' only if the
   *     order has not already succeeded.
   *   - Does NOT delete, refund, or create any record.
   */
  private async handlePaymentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(
      `[WebhookService] payment_intent.canceled — paymentIntentId: ${paymentIntent.id}`
    );

    const order = await this.orderRepo.getOrderByPaymentIntentId(paymentIntent.id);

    if (!order) {
      console.log(
        `[WebhookService] payment_intent.canceled — no order found for paymentIntentId: ${paymentIntent.id}. No action taken.`
      );
      return;
    }

    if (order.paymentStatus === 'succeeded') {
      // Defensive guard: a cancellation after capture would need manual review.
      console.warn(
        `[WebhookService] payment_intent.canceled — order ${order.id} is already succeeded. Not overwriting. Manual review recommended.`
      );
      return;
    }

    await this.orderRepo.updateOrder(order.id, {
      paymentStatus: 'failed',
      status: 'failed',
    });

    console.log(
      `[WebhookService] payment_intent.canceled — order ${order.id} updated to paymentStatus: failed.`
    );
  }
}
