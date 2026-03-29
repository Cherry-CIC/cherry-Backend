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
 *               - deliveryType
 *               - shippingOptionId
 *               - shippingWeight
 *               - shipping
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount in the smallest currency unit (e.g., pence)
 *               paymentIntentId:
 *                 type: string
 *                 description: Stripe payment intent id that must already be in succeeded state
 *               productId:
 *                 type: string
 *               productName:
 *                 type: string
 *               deliveryType:
 *                 type: string
 *                 enum: [home, pickup_point]
 *               shippingOptionId:
 *                 type: string
 *                 description: Sendcloud checkout identifier or shipping method id selected during checkout
 *               shippingOptionName:
 *                 type: string
 *               shippingOptionPrice:
 *                 type: string
 *               shippingCarrier:
 *                 type: string
 *               shippingWeight:
 *                 type: integer
 *                 description: Parcel weight in grams
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
 *                       - city
 *                       - postal_code
 *                       - country
 *                     properties:
 *                       line1:
 *                         type: string
 *                       line2:
 *                         type: string
 *                       city:
 *                         type: string
 *                       state:
 *                         type: string
 *                       postal_code:
 *                         type: string
 *                       country:
 *                         type: string
 *                         example: "GB"
 *                   name:
 *                     type: string
 *               pickupPoint:
 *                 type: object
 *                 description: Required when deliveryType is pickup_point
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   addressLine1:
 *                     type: string
 *                   city:
 *                     type: string
 *                   postalCode:
 *                     type: string
 *                   country:
 *                     type: string
 *                   carrier:
 *                     type: string
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
