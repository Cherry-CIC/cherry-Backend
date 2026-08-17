import { Router } from 'express';
import {
  confirmOrderReceived,
  createOrder,
  getMyOrderById,
  getMyOrders,
  submitOrderDispute,
} from '../controllers/orderController';
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
 * components:
 *   schemas:
 *     ShipmentSummary:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         provider:
 *           type: string
 *           nullable: true
 *           example: "sendcloud"
 *         carrier:
 *           type: string
 *           nullable: true
 *           example: "inpost_gb"
 *         status:
 *           type: string
 *           example: "en_route"
 *         trackingNumber:
 *           type: string
 *           nullable: true
 *         trackingUrl:
 *           type: string
 *           nullable: true
 *         labelUrl:
 *           type: string
 *           nullable: true
 *         pickupPoint:
 *           type: object
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ClientOrder:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         productId:
 *           type: string
 *         productName:
 *           type: string
 *         totalAmount:
 *           type: integer
 *           example: 2599
 *         currency:
 *           type: string
 *           example: "GBP"
 *         paymentStatus:
 *           type: string
 *           example: "succeeded"
 *         paymentState:
 *           type: string
 *           example: "paid"
 *         status:
 *           type: string
 *           example: "shipped"
 *         shipmentStatus:
 *           type: string
 *           example: "en_route"
 *         deliveryState:
 *           type: string
 *           example: "shipped"
 *         deliveryLabel:
 *           type: string
 *           example: "On the way"
 *         canTrack:
 *           type: boolean
 *           example: true
 *         trackingNumber:
 *           type: string
 *           nullable: true
 *         trackingUrl:
 *           type: string
 *           nullable: true
 *         carrier:
 *           type: string
 *           nullable: true
 *         deliveryAddressSummary:
 *           type: string
 *           example: "10 High Street, London, SW1A 1AA, GB"
 *         pickupPoint:
 *           type: object
 *         shipment:
 *           allOf:
 *             - $ref: '#/components/schemas/ShipmentSummary'
 *           nullable: true
 *         buyerConfirmedReceived:
 *           type: boolean
 *           example: true
 *         buyerConfirmedReceivedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         buyerDisputeReason:
 *           type: string
 *           enum: [wrong_item, item_not_as_described, item_arrived_damaged, something_else]
 *           nullable: true
 *         buyerDisputeStatus:
 *           type: string
 *           enum: [under_review]
 *           nullable: true
 *         buyerDisputeMessage:
 *           type: string
 *           nullable: true
 *         buyerDisputedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *
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
 *                         $ref: '#/components/schemas/ClientOrder'
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
 * /api/order/my-orders:
 * /api/order/{id}:
 *   get:
 *     summary: Get a single order for the authenticated user
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order fetched successfully
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
 *                     order:
 *                       $ref: '#/components/schemas/ClientOrder'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
router.post('/create', authMiddleware, validateOrder, createOrder);

/**
 * @swagger
 * /api/order/{id}/confirm-received:
 *   post:
 *     summary: Confirm the authenticated buyer has received an order
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order receipt confirmed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order is not eligible for receipt confirmation
 *       500:
 *         description: Internal server error
 */
router.post('/:id/confirm-received', authMiddleware, confirmOrderReceived);

/**
 * @swagger
 * /api/order/{id}/dispute:
 *   post:
 *     summary: Submit a buyer dispute for an order
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [wrong_item, item_not_as_described, item_arrived_damaged, something_else]
 *               message:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Order dispute submitted
 *       400:
 *         description: Invalid dispute payload
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order is not eligible for dispute submission
 *       500:
 *         description: Internal server error
 */
router.post('/:id/dispute', authMiddleware, submitOrderDispute);

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

/**
 * @swagger
 * /api/order/{id}:
 *   get:
 *     summary: Get a single order for the authenticated user
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order fetched successfully
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
 *                     order:
 *                       $ref: '#/components/schemas/ClientOrder'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', authMiddleware, getMyOrderById);

export default router;
