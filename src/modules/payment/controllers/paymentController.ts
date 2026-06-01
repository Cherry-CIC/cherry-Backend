import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { PaymentService } from '../services/PaymentService';
import {
  INVALID_PAYMENT_AMOUNT_MESSAGE,
  parsePositivePenceAmount,
} from '../utils/paymentAmount';

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
 *                     paymentIntent:
 *                       type: string
 *                       description: Backwards-compatible alias for clientSecret
 *                     clientSecret:
 *                       type: string
 *                       description: Stripe PaymentIntent client secret used by the Flutter Stripe SDK
 *                     ephemeralKey:
 *                       type: string
 *                     customer:
 *                       type: string
 *                     publishableKey:
 *                       type: string
 *                     amount:
 *                       type: integer
 *                       description: PaymentIntent amount in pence
 *                     currency:
 *                       type: string
 *                       example: gbp
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const createPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user.uid;
  
    // Extract amount (currency is fixed to GBP)
    const { amount } = req.body;
    const totalAmountPence = parsePositivePenceAmount(amount);
  
    // Use service to handle Stripe logic and reuse existing customers when possible
    const paymentService = new PaymentService();
    const responseData = await paymentService.createPaymentIntentForUserByUid(
      firebaseUid,
      totalAmountPence
    );

    ResponseHandler.success(res, responseData, 'PaymentIntent created');
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === INVALID_PAYMENT_AMOUNT_MESSAGE
    ) {
      ResponseHandler.badRequest(res, 'Invalid amount', err.message);
      return;
    }

    ResponseHandler.internalServerError(
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
