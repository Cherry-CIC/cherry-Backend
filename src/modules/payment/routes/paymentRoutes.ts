import { Router } from 'express';
import { createPaymentIntent } from '../controllers/paymentController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { stripeWebhook } from '../controllers/paymentController';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Payment
 *   description: Stripe payment handling
 */

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

router.post('/create-payment-intent', authMiddleware, createPaymentIntent);
router.post('/webhook', stripeWebhook);

export default router;
