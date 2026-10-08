import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { CheckoutContextRepository } from '../CheckoutContextRepository';
import { stripe } from '../../../shared/config/stripeConfig';
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

    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.canceled'
    ) {
      // Retrieve current provider state so delayed events cannot regress state.
      const payment = await stripe.paymentIntents.retrieve(
        (event.data.object as any).id,
      );
      if (
        payment.metadata.checkoutSessionId &&
        ['succeeded', 'canceled'].includes(payment.status)
      ) {
        await new CheckoutContextRepository().recordProviderState(
          payment.metadata.checkoutSessionId,
          payment.id,
          payment.status === 'succeeded' ? 'succeeded' : 'cancelled',
          payment.metadata,
        );
      }
    }

    ResponseHandler.success(res, {}, 'Webhook received');
  } catch (err) {
    console.error('Stripe webhook processing failed');
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      'Webhook verification or processing failed',
    );
  }
};
