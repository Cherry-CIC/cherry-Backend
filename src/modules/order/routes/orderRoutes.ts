import { Router } from 'express';
import express from 'express';
import { createOrder, getAllOrders } from '../controllers/orderController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateOrder } from '../validators/orderValidator';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Order
 *   description: Order handling after Stripe PaymentSheet success
 */

/**
 * @swagger
 * /api/order/create:
 *   post:
 *     summary: Create an order after Stripe PaymentSheet succeeds
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
 *               - deliveryType
 *               - shippingOptionId
 *               - productId
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Total amount in pence
 *               paymentIntentId:
 *                 type: string
 *                 description: Stripe PaymentIntent ID confirmed server-side before order creation
 *               deliveryType:
 *                 type: string
 *                 enum: [home, pickup_point]
 *               productId:
 *                 type: string
 *               productName:
 *                 type: string
 *                 description: Accepted for frontend compatibility but not trusted for order pricing or charity routing
 *               shippingOptionId:
 *                 type: string
 *                 enum: [mvp-home-delivery, mvp-pickup-point-delivery]
 *               shippingWeight:
 *                 type: integer
 *                 description: Parcel weight in grams. Defaults to 500 for MVP checkout.
 *               shippingOptionName:
 *                 type: string
 *               shippingOptionPrice:
 *                 type: integer
 *                 description: Frontend display value in pence. Server pricing is used for validation.
 *               shippingCarrier:
 *                 type: string
 *               shipping:
 *                 type: object
 *                 description: Required for home delivery
 *                 properties:
 *                   address:
 *                     type: object
 *                     properties:
 *                       line1: {type: string}
 *                       line2: {type: string}
 *                       city: {type: string}
 *                       state: {type: string}
 *                       postal_code: {type: string}
 *                       country:
 *                         type: string
 *                         enum: [GB]
 *                   name: {type: string}
 *               pickupPoint:
 *                 type: object
 *                 description: Required for pickup_point delivery
 *                 properties:
 *                   id: {type: string}
 *                   name: {type: string}
 *                   addressLine1: {type: string}
 *                   city: {type: string}
 *                   postalCode: {type: string}
 *                   country:
 *                     type: string
 *                     enum: [GB]
 *                   carrier: {type: string}
 *     responses:
 *       200:
 *         description: Order created or returned idempotently
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
 *                     orderId:
 *                       type: string
 *                     paymentIntentId:
 *                       type: string
 *                     paymentStatus:
 *                       type: string
 *                     shipmentStatus:
 *                       type: string
 *                       description: announced when shipment exists, pending when shipment creation is deferred
 *                     shipmentId:
 *                       type: string
 *                     idempotent:
 *                       type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/create', authMiddleware, validateOrder, createOrder);

/**
 * @swagger
 * /api/order/all:
 *   get:
 *     summary: Retrieve all orders (admin purpose)
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/all', authMiddleware, getAllOrders);

export default router;
