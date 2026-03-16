import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { createWebhook } from '../../../shared/config/stripeConfig';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { PaymentService } from '../services/PaymentService';

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
 *                     paymentIntent:
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
export const createPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user.uid;
  
    // Extract amount (currency is fixed to GBP)
    const { amount } = req.body;
  
    // Use service to handle Stripe logic and reuse existing customers when possible
    const paymentService = new PaymentService();
    const responseData = await paymentService.createPaymentIntentForUserByUid(firebaseUid, amount);

    ResponseHandler.success(res, responseData, 'PaymentIntent created');
  } catch (err) {
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