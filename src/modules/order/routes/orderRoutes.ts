import { Router } from 'express';
import { createOrder, getMyOrders } from '../controllers/orderController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateOrder } from '../validators/orderValidator';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Order
 *   description: Paid order and shipment handling
 */

/**
 * @swagger
 * /api/order/my-orders:
 *   get:
 *     summary: Get orders for the authenticated user
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Orders fetched successfully
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
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                     count:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/my-orders', authMiddleware, getMyOrders);

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
 *               - productId
 *               - paymentIntentId
 *               - shipping
 *               - pickupPoint
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "product-001"
 *               paymentIntentId:
 *                 type: string
 *                 description: Paid Stripe PaymentIntent containing trusted checkout metadata
 *                 example: "pi_REPLACE_WITH_REAL_ID_ONLY"
 *               shipping:
 *                 type: object
 *                 required:
 *                   - address
 *                   - name
 *                   - telephone
 *                 properties:
 *                   address:
 *                     type: object
 *                     required:
 *                       - line1
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
 *       409:
 *         description: Payment already used or checkout data is no longer valid
 *       500:
 *         description: Internal server error
 */
router.post('/create', authMiddleware, validateOrder, createOrder);

export default router;
