import { sendListingSafetyError } from '../../../shared/utils/listingSafety';
import { ListingReservationRepository } from '../repositories/ListingReservationRepository';
import { stripe } from '../../../shared/config/stripeConfig';
import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { PaymentService } from '../services/PaymentService';

export const createPaymentIntent = async (
  req: Request,
  res: Response,
): Promise<void> => {
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
    if (sendListingSafetyError(res, err)) return;
    ResponseHandler.badRequest(
      res,
      'Failed to create PaymentIntent',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

// Stripe webhook endpoint (moved from webhookController)
export const stripeWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      ResponseHandler.badRequest(res, 'Missing Stripe signature header');
      return;
    }

    // Raw body is required for signature verification
    const rawBody = (req as any).rawBody || req.body;
    const event = createWebhook(rawBody, sig);

    if (event.type.startsWith('payment_intent.')) {
      // Retrieve current Stripe state so delayed events cannot release a live lock.
      const intent = await stripe.paymentIntents.retrieve(
        (event.data.object as any).id,
      );
      await new ListingReservationRepository().applyStripeState(intent);
    }

    ResponseHandler.success(res, {}, 'Webhook received');
  } catch (err) {
    console.error('⚠️ Webhook error:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const cancelPayment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = req.body.paymentIntentId;
    if (typeof id !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(id)) {
      ResponseHandler.badRequest(res, 'A valid paymentIntentId is required');
      return;
    }
    await new PaymentService().cancelPaymentForUser((req as any).user.uid, id);
    ResponseHandler.success(res, {}, 'Payment cancelled');
  } catch (error) {
    if (sendListingSafetyError(res, error)) return;
    ResponseHandler.internalServerError(res, 'Unable to cancel payment');
  }
};
