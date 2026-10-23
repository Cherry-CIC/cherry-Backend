import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { PaymentService } from '../services/PaymentService';
import { isPayoutHoldEvent } from '../services/payoutHoldEvents';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import Stripe from 'stripe';

export const createPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user.uid;

    const orderId = new OrderRepository().createOrderId();
    const paymentService = new PaymentService();
    const responseData = await paymentService.createPaymentIntentForUserByUid(
      firebaseUid,
      orderId,
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
 
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) {
    ResponseHandler.badRequest(res, 'Missing Stripe signature header');
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = (req as any).rawBody || req.body;
    event = createWebhook(rawBody, sig);
  } catch (err) {
    ResponseHandler.badRequest(
      res,
      'Invalid Stripe webhook signature',
      err instanceof Error ? err.message : 'Unknown error',
    );
    return;
  }

  try {
    const paymentService = new PaymentService();
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await paymentService.handleSucceededPaymentIntent(paymentIntent.id);
      const { StripeWebhookService } = await import(
        '../services/StripeWebhookService'
      );
      await new StripeWebhookService().handleEvent(event);
    } else if (event.type === 'payment_intent.canceled') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await paymentService.handleCanceledPaymentIntent(
        paymentIntent.id,
        paymentIntent.metadata.orderId,
      );
    } else if (isPayoutHoldEvent(event.type)) {
      const { StripeWebhookService } = await import(
        '../services/StripeWebhookService'
      );
      await new StripeWebhookService().handleEvent(event);
    }

    ResponseHandler.success(res, {}, 'Webhook received');
  } catch (err) {
    console.error('Stripe webhook processing failed:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
