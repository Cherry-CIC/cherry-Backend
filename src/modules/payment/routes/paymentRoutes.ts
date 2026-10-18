import { Router } from 'express';
import { cancelPaymentIntent, createPaymentIntent } from '../controllers/paymentController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import { cancelPaymentIntentValidator, createPaymentIntentValidator } from '../validators/paymentValidator';

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
 *     summary: Create a pending order and Stripe PaymentIntent for the authenticated user
 *     description: >
 *       Creates a durable pending order before creating the PaymentIntent and returns its
 *       server-generated orderId. The server derives the buyer from authentication, seller
 *       and charity from the product record, and all amounts from trusted product and
 *       shipping data. The orderId and trusted participant IDs are attached to Stripe
 *       metadata. The client must use the returned orderId and paymentIntentId when
 *       confirming the order.
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
 *               - shipping
 *               - pickupPoint
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "product-001"
 *               expectedEditVersion:
 *                 type: integer
 *                 minimum: 0
 *                 description: Required for an edited listing. Must match its latest editVersion.
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
 *               shipping:
 *                 type: object
 *                 required: [address, name, telephone]
 *                 properties:
 *                   address:
 *                     type: object
 *                     required: [line1, city, postal_code, country]
 *                     properties:
 *                       line1:
 *                         type: string
 *                         example: "18 Calderwood Street"
 *                       line2:
 *                         type: string
 *                         example: "Flat 7"
 *                       house_number:
 *                         type: string
 *                         example: "18"
 *                       city:
 *                         type: string
 *                         example: "London"
 *                       state:
 *                         type: string
 *                         example: "Greater London"
 *                       postal_code:
 *                         type: string
 *                         example: "SE18 6QW"
 *                       country:
 *                         type: string
 *                         minLength: 2
 *                         maxLength: 2
 *                         example: "GB"
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   telephone:
 *                     type: string
 *                     example: "+447700900000"
 *               pickupPoint:
 *                 type: object
 *                 required: [id, name, addressLine1, city, postalCode, country, carrier]
 *                 properties:
 *                   id:
 *                     type: string
 *                     example: "13127548"
 *                   name:
 *                     type: string
 *                     example: "InPost Locker"
 *                   addressLine1:
 *                     type: string
 *                     example: "123 High Street"
 *                   city:
 *                     type: string
 *                     example: "London"
 *                   postalCode:
 *                     type: string
 *                     example: "SE7 8UG"
 *                   country:
 *                     type: string
 *                     minLength: 2
 *                     maxLength: 2
 *                     example: "GB"
 *                   carrier:
 *                     type: string
 *                     enum: [inpost_gb]
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
 *                   required:
 *                     - orderId
 *                     - paymentIntentId
 *                     - clientSecret
 *                     - productAmount
 *                     - shippingFee
 *                     - securityFee
 *                     - totalAmount
 *                     - currency
 *                   properties:
 *                     orderId:
 *                       type: string
 *                       description: Server-generated ID of the durable pending order
 *                       example: "order-001"
 *                     paymentIntentId:
 *                       type: string
 *                     paymentStatus:
 *                       type: string
 *                       description: Current Stripe status, including succeeded on an idempotent retry.
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
 *                       description: Product price in GBP pence
 *                     shippingFee:
 *                       type: integer
 *                       description: Shipping fee in GBP pence
 *                     securityFee:
 *                       type: integer
 *                       description: Purchase security fee in GBP pence (10% of item price, minimum 100p)
 *                     totalAmount:
 *                       type: integer
 *                       description: Total Stripe charge in GBP pence
 *                     currency:
 *                       type: string
 *                       enum: [GBP]
 *                       example: "GBP"
 *       400:
 *         description: Bad request
 *       409:
 *         $ref: "#/components/responses/ListingConflictError"
 *       500:
 *         description: Internal server error
 */

router.post(
  '/create-payment-intent',
  authMiddleware,
  validateRequest(createPaymentIntentValidator),
  createPaymentIntent,
);
/**
 * @swagger
 * /api/payment/cancel-payment-intent:
 *   post:
 *     summary: Cancel an owned payment and release its pending order after confirmation
 *     tags: [Payment]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentIntentId]
 *             properties:
 *               paymentIntentId: { type: string }
 *     responses:
 *       200: { description: Stripe cancellation confirmed }
 *       403: { description: Payment belongs to another account }
 *       409: { description: Payment is still actionable or needs reconciliation }
 */
router.post('/cancel-payment-intent', authMiddleware, validateRequest(cancelPaymentIntentValidator), cancelPaymentIntent);
export default router;
