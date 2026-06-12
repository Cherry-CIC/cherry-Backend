import { Router } from 'express';
import { createPaymentIntent } from '../controllers/paymentController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import { createPaymentIntentValidator } from '../validators/paymentValidator';

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
 *               - productId
 *               - shippingMethodId
 *               - pickupPointId
 *               - country
 *               - postalCode
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "product-001"
 *               shippingMethodId:
 *                 type: string
 *                 example: "3747"
 *               pickupPointId:
 *                 type: string
 *                 example: "13127548"
 *               country:
 *                 type: string
 *                 example: "GB"
 *               postalCode:
 *                 type: string
 *                 example: "SE18 4QH"
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
 *                     productAmount:
 *                       type: integer
 *                       description: Product price in pence
 *                     shippingFee:
 *                       type: integer
 *                       description: Shipping fee in pence
 *                     securityFee:
 *                       type: integer
 *                       description: 10% purchase security fee in pence
 *                     totalAmount:
 *                       type: integer
 *                       description: Total Stripe charge in pence
 *                     currency:
 *                       type: string
 *                       example: "GBP"
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */

router.post(
  '/create-payment-intent',
  authMiddleware,
  validateRequest(createPaymentIntentValidator),
  createPaymentIntent,
);
export default router;
