import { Router } from 'express';
import { createOrder } from '../controllers/orderController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateOrder } from '../validators/orderValidator';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Order
 *   description: Order handling (Stripe Checkout Sessions)
 */

/**
 * @swagger
 * /api/order/create:
 *   post:
 *     summary: Create a paid order and create its shipment
 *     tags: [Order]
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
 *               - paymentIntentId
 *               - shippingMethodId
 *               - shippingCarrier
 *               - shippingWeight
 *               - shipping
 *               - pickupPoint
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount in the smallest currency unit (e.g., pence)
 *                 example: 50
 *               paymentIntentId:
 *                 type: string
 *                 description: Stripe payment intent id that must already be in succeeded state
 *                 example: "pi_REPLACE_WITH_REAL_ID_ONLY"
 *               productId:
 *                 type: string
 *                 example: "product-001"
 *               productName:
 *                 type: string
 *                 example: "Denim Jacket"
 *               shippingMethodId:
 *                 type: string
 *                 description: Sendcloud shipping method id selected during checkout
 *                 example: "3747"
 *               shippingCarrier:
 *                 type: string
 *                 enum: [inpost_gb]
 *               shippingWeight:
 *                 type: integer
 *                 description: Parcel weight in grams
 *                 example: 2500
 *               shipping:
 *                 type: object
 *                 required:
 *                   - address
 *                   - name
 *                 properties:
 *                   address:
 *                     type: object
 *                     required:
 *                       - line1
 *                       - house_number
 *                       - city
 *                       - postal_code
 *                       - country
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
 *                         example: "GB"
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   telephone:
 *                     type: string
 *                     example: "+447700900000"
 *               pickupPoint:
 *                 type: object
 *                 description: Required. Must be an InPost pickup point.
 *                 required:
 *                   - id
 *                   - name
 *                   - addressLine1
 *                   - city
 *                   - postalCode
 *                   - country
 *                   - carrier
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
 *                     example: "GB"
 *                   carrier:
 *                     type: string
 *                     enum: [inpost_gb]
 *     responses:
 *       200:
 *         description: Order and shipment created successfully
 *       202:
 *         description: Order created but shipment creation is pending
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/create', authMiddleware, validateOrder, createOrder);

export default router;
