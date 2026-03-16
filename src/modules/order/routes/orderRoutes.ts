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
 *     summary: Create a new Order (Stripe Checkout Session)
 *     tags: [Order]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount in the smallest currency unit (e.g., pence)
 *               productId:
 *                 type: string
 *               productName:
 *                 type: string
 *               shipping:
 *                 type: object
 *                 properties:
 *                   address:
 *                     type: object
 *                     properties:
 *                       line1: {type: string}
 *                       line2: {type: string}
 *                       city: {type: string}
 *                       state: {type: string}
 *                       postal_code: {type: string}
 *                       country: {type: string}
 *                   name: {type: string}
 *     responses:
 *       200:
 *         description: Order (Checkout Session) created
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