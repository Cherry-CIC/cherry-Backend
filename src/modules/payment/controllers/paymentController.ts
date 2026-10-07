import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import Stripe from 'stripe';
import { PaymentService } from '../services/PaymentService';
import { StripeWebhookService } from '../services/StripeWebhookService';

export const createPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user.uid;

    const paymentService = new PaymentService();
    const responseData = await paymentService.createPaymentIntentForUserByUid(
      firebaseUid,
      req.body,
    );

    ResponseHandler.success(res, responseData, 'PaymentIntent created');
  } catch (err) {
    ResponseHandler.badRequest(
      res,
      'Failed to create PaymentIntent',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
 
/**
 * @swagger
 * /api/payment/webhook:
 *   post:
 *     summary: Stripe webhook (called by Stripe, not the app)
 *     description: Records successful payments in payments/{paymentIntentId} and links them to the order.
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Missing or invalid Stripe signature
 *       500:
 *         description: Processing failed; Stripe will retry
 */
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string' || !sig) {
    ResponseHandler.badRequest(res, 'Missing Stripe signature header');
    return;
  }

  let event: Stripe.Event;
  try {
    // Raw body is required for signature verification
    const rawBody = (req as any).rawBody || req.body;
    event = createWebhook(rawBody, sig);
  } catch (err) {
    console.warn('Rejected Stripe webhook:', err instanceof Error ? err.message : err);
    ResponseHandler.badRequest(res, 'Invalid Stripe signature');
    return;
  }

  try {
    const outcome = await new StripeWebhookService().handleEvent(event);
    ResponseHandler.success(res, outcome, 'Webhook received');
  } catch (err) {
    // Non-2xx makes Stripe retry the event
    console.error(`Failed to process Stripe event ${event.id}:`, err);
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
