import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { PaymentService } from '../services/PaymentService';
import { WebhookService } from '../services/WebhookService';
import { WebhookEventRepository } from '../WebhookEventRepository';

/**
 * @swagger
 * /api/payment/create-payment-intent:
 *   post:
 *     summary: Create a Stripe PaymentIntent for the authenticated user
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount in the smallest currency unit (e.g., cents)
 *     responses:
 *       200:
 *         description: PaymentIntent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentIntentId:
 *                       type: string
 *                     clientSecret:
 *                       type: string
 *                     ephemeralKey:
 *                       type: string
 *                     customer:
 *                       type: string
 *                     publishableKey:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const createPaymentIntent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user.uid;

    // Extract amount (currency is fixed to GBP)
    const { amount } = req.body;

    // Use service to handle Stripe logic and reuse existing customers when possible
    const paymentService = new PaymentService();
    const responseData = await paymentService.createPaymentIntentForUserByUid(
      firebaseUid,
      amount,
    );

    ResponseHandler.success(res, responseData, 'PaymentIntent created');
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to create PaymentIntent',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

/**
 * POST /api/payment/webhook
 *
 * Stripe webhook endpoint. Handles the following subscribed events:
 *   - payment_intent.succeeded
 *   - payment_intent.processing
 *   - payment_intent.payment_failed
 *   - payment_intent.canceled
 *
 * Security:
 *   - Signature is verified using stripe.webhooks.constructEvent with
 *     STRIPE_WEBHOOK_SECRET. Invalid signatures return 400 immediately.
 *
 * Idempotency:
 *   - Each Stripe event ID is stored in Firestore after successful processing.
 *   - Duplicate event deliveries (Stripe retries) return 200 immediately without
 *     repeating any side effects.
 *
 * Error handling:
 *   - 400: missing or invalid Stripe signature
 *   - 200: valid event processed (or safely skipped as duplicate/unsupported)
 *   - 500: unexpected internal error (Stripe will retry; event NOT marked processed)
 */
export const stripeWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // ── Step 1: Verify the Stripe signature ──────────────────────────────────────
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (!sig) {
    console.warn('[Webhook] Rejected: missing stripe-signature header.');
    ResponseHandler.badRequest(res, 'Missing Stripe signature header');
    return;
  }

  let event;
  try {
    // req.body is the raw Buffer provided by express.raw() in paymentRoutes.ts.
    event = createWebhook(req.body as Buffer, sig);
  } catch (err) {
    // constructEvent throws when the signature is invalid or the payload is
    // malformed. This is not a server error — return 400 so Stripe stops retrying.
    console.warn(
      `[Webhook] Rejected: invalid signature. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    ResponseHandler.badRequest(
      res,
      'Invalid webhook signature',
      err instanceof Error ? err.message : 'Signature verification failed',
    );
    return;
  }

  console.log(`[Webhook] Received event: ${event.type} (id: ${event.id})`);

  // ── Step 2: Atomically claim the event for processing ────────────────────────
  // We use a single atomic Firestore create() to claim the event. This is the
  // only race-safe way to dedupe under concurrent Stripe deliveries — a
  // check-then-set would allow two simultaneous requests to both pass the check
  // and double-process. If the claim fails because another delivery already
  // holds it (processing OR already processed), this delivery is a duplicate.
  const webhookEventRepo = new WebhookEventRepository();

  let claimResult: import('../WebhookEventRepository').ClaimResult;
  try {
    claimResult = await webhookEventRepo.claim(event.id, event.type);
  } catch (err) {
    // Firestore write failure (not an idempotency signal — those return a
    // ClaimResult string). Return 500 so Stripe retries.
    console.error(
      `[Webhook] Failed to claim event ${event.id} for processing:`,
      err,
    );
    ResponseHandler.internalServerError(
      res,
      'Webhook idempotency check failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
    return;
  }

  if (claimResult === 'already_processed') {
    console.log(
      `[Webhook] Duplicate event ignored (already processed): ${event.type} (id: ${event.id})`,
    );
    ResponseHandler.success(res, { received: true }, 'Duplicate event ignored');
    return;
  }

  if (claimResult === 'in_progress') {
    console.log(
      `[Webhook] Duplicate event ignored (claim in progress): ${event.type} (id: ${event.id})`,
    );
    // Another delivery holds a live lease. Return 200 so Stripe does not
    // immediately retry; Stripe's own retry schedule will re-deliver if the
    // current holder crashes and the lease goes stale.
    ResponseHandler.success(res, { received: true }, 'Event already in progress');
    return;
  }

  // ── Step 3: Process the event ─────────────────────────────────────────────────
  try {
    const webhookService = new WebhookService();
    await webhookService.handleStripeEvent(event);

    // Mark as processed ONLY after successful side effects. If handleStripeEvent
    // throws we release the claim below so Stripe's retry can re-acquire it.
    await webhookEventRepo.markAsProcessed(event.id, event.type);

    console.log(
      `[Webhook] Successfully processed event: ${event.type} (id: ${event.id})`,
    );
    ResponseHandler.success(res, { received: true }, 'Webhook processed');
  } catch (err) {
    // Business logic or the final Firestore write failed. Release the claim so
    // the next Stripe retry can re-claim and re-process. WebhookService handlers
    // are individually idempotent (no-op when the target state is already set),
    // so partial side effects from this attempt remain safe under retry.
    console.error(
      `[Webhook] Unexpected error processing event ${event.type} (id: ${event.id}):`,
      err,
    );
    try {
      await webhookEventRepo.releaseClaim(event.id);
    } catch (releaseErr) {
      // If we cannot release the claim, the event will be blocked from
      // reprocessing until the claim row is removed manually. Log loudly so
      // operators can intervene; do not mask the original error.
      console.error(
        `[Webhook] Failed to release claim for event ${event.id} after processing error. Manual cleanup of stripe_webhook_events/${event.id} may be required:`,
        releaseErr,
      );
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook event',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
