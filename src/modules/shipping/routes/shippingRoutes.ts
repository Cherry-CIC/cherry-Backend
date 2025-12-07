import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import {
  createShipment,
  getShipmentStatus,
  getShippingLabel,
  getShippingMethods,
  cancelShipment,
  handleSendcloudWebhook,
  getAllShipments,
} from '../controllers/shippingController';
import {
  createShipmentValidator,
  orderIdParamValidator,
  shipmentStatusQueryValidator,
} from '../validators/shippingValidator';

const router = Router();

/**
 * @swagger
 * /api/shipping/shipment:
 *   post:
 *     summary: Create a shipment for an order
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *               weight:
 *                 type: number
 *               shippingMethodId:
 *                 type: number
 *     responses:
 *       200:
 *         description: Shipment created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/shipment',
  authMiddleware,
  adminMiddleware,
  validateRequest(createShipmentValidator),
  createShipment
);

/**
 * @swagger
 * /api/shipping/shipment/{orderId}:
 *   get:
 *     summary: Get shipment status by order ID
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shipment status retrieved
 *       404:
 *         description: Shipment not found
 */
router.get(
  '/shipment/:orderId',
  authMiddleware,
  getShipmentStatus
);

/**
 * @swagger
 * /api/shipping/label/{orderId}:
 *   get:
 *     summary: Get shipping label URL
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Label URL retrieved
 *       404:
 *         description: Label not found
 */
router.get(
  '/label/:orderId',
  authMiddleware,
  adminMiddleware,
  getShippingLabel
);

/**
 * @swagger
 * /api/shipping/methods:
 *   get:
 *     summary: Get available shipping methods
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shipping methods retrieved
 */
router.get('/methods', authMiddleware, getShippingMethods);

/**
 * @swagger
 * /api/shipping/cancel/{orderId}:
 *   post:
 *     summary: Cancel a shipment
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shipment cancelled
 *       404:
 *         description: Shipment not found
 */
router.post(
  '/cancel/:orderId',
  authMiddleware,
  adminMiddleware,
  cancelShipment
);

/**
 * @swagger
 * /api/shipping/shipments:
 *   get:
 *     summary: Get all shipments (admin only)
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, announced, en_route, out_for_delivery, delivered, exception, cancelled]
 *     responses:
 *       200:
 *         description: Shipments retrieved
 */
router.get(
  '/shipments',
  authMiddleware,
  adminMiddleware,
  getAllShipments
);

/**
 * @swagger
 * /api/shipping/webhook:
 *   post:
 *     summary: Sendcloud webhook endpoint
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.post('/webhook', handleSendcloudWebhook);

export default router;