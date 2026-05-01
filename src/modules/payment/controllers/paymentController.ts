import { Request, Response } from 'express';
import Stripe from 'stripe';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { PaymentService } from '../services/PaymentService';
import { OrderRepository } from '../../order/repositories/OrderRepository';

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
 *                 description: Total amount in pence
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
 *                     paymentIntent:
 *                       type: string
 *                       description: Stripe client secret for PaymentSheet
 *                     paymentIntentId:
 *                       type: string
 *                       description: Stripe PaymentIntent ID for order creation
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
    const firebaseUid = user?.uid;
    if (!firebaseUid) {
      ResponseHandler.unauthorized(
        res,
        'User not authenticated',
        'Authentication required',
      );
      return;
    }

    const { amount } = req.body;
    if (!Number.isInteger(amount) || amount <= 0) {
      ResponseHandler.badRequest(
        res,
        'Invalid payment amount',
        'amount must be a positive integer in pence',
      );
      return;
    }

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

    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled' ||
      event.type === 'payment_intent.processing'
    ) {
      const orderRepo = new OrderRepository();
      await orderRepo.updatePaymentStatusByPaymentIntentId(
        paymentIntent.id,
        paymentIntent.status,
      );
      console.log(
        `Stripe PaymentIntent ${paymentIntent.id} status ${paymentIntent.status}`,
      );
    }

    ResponseHandler.success(res, {}, 'Webhook received');
  } catch (err) {
    console.error('Stripe webhook error:', err);

    if (
      err instanceof Stripe.errors.StripeSignatureVerificationError ||
      (err instanceof Error && err.name === 'StripeSignatureVerificationError')
    ) {
      ResponseHandler.badRequest(
        res,
        'Invalid Stripe webhook signature',
        err.message,
      );
      return;
    }

    ResponseHandler.internalServerError(
      res,
      'Failed to process webhook',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
