import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { PaymentService } from '../services/PaymentService';

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
 
// Stripe webhook endpoint (moved from webhookController)
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      ResponseHandler.badRequest(res, 'Missing Stripe signature header');
      return;
    }

    // Raw body is required for signature verification
    const rawBody = (req as any).rawBody || req.body;
    const event = createWebhook(rawBody, sig);

    // Example handling – extend as needed
    if (event.type === 'payment_intent.succeeded') {
      console.log('✅ Payment succeeded:', (event.data.object as any).id);
    }

    ResponseHandler.success(res, {}, 'Webhook received');
  } catch (err) {
    console.error('⚠️ Webhook error:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};
