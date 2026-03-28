import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import {
  createShipment,
  getCheckoutShippingOptions,
  getPickupPoints,
  getShipmentStatus,
  getShippingLabel,
  getShippingMethods,
  cancelShipment,
  handleSendcloudWebhook,
  getAllShipments,
} from '../controllers/shippingController';
import {
  checkoutShippingOptionsQueryValidator,
  createShipmentValidator,
  orderIdParamValidator,
  pickupPointsQueryValidator,
  shipmentStatusQueryValidator,
} from '../validators/shippingValidator';

const router = Router();

/**
 * @swagger
 * /api/shipping/options:
 *   get:
 *     summary: Get checkout shipping options for a destination and cart context
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: country
 *         required: true
 *         schema:
 *           type: string
 *           example: "GB"
 *       - in: query
 *         name: postalCode
 *         required: true
 *         schema:
 *           type: string
 *           example: "SW1A 1AA"
 *       - in: query
 *         name: weight
 *         required: true
 *         schema:
 *           type: integer
 *           example: 2500
 *         description: Total cart weight in grams
 *       - in: query
 *         name: value
 *         required: true
 *         schema:
 *           type: string
 *           example: "45.90"
 *         description: Total cart value in decimal currency format
 *     responses:
 *       200:
 *         description: Checkout shipping options retrieved successfully
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
 *                     options:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           description:
 *                             type: string
 *                           deliveryType:
 *                             type: string
 *                             enum: [home, pickup_point]
 *                           deliveryMethodType:
 *                             type: string
 *                           price:
 *                             type: string
 *                             nullable: true
 *                           currency:
 *                             type: string
 *                             nullable: true
 *                           carrier:
 *                             type: string
 *                             nullable: true
 *                           checkoutIdentifier:
 *                             type: string
 *                             nullable: true
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get(
  '/options',
  authMiddleware,
  validateRequest(checkoutShippingOptionsQueryValidator, 'query'),
  getCheckoutShippingOptions
);

/**
 * @swagger
 * /api/shipping/pickup-points:
 *   get:
 *     summary: Get available pickup points for a destination
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: country
 *         required: true
 *         schema:
 *           type: string
 *           example: "GB"
 *       - in: query
 *         name: postalCode
 *         required: true
 *         schema:
 *           type: string
 *           example: "SW1A 1AA"
 *       - in: query
 *         name: city
 *         required: false
 *         schema:
 *           type: string
 *           example: "London"
 *       - in: query
 *         name: address
 *         required: false
 *         schema:
 *           type: string
 *           example: "10 High Street"
 *       - in: query
 *         name: houseNumber
 *         required: false
 *         schema:
 *           type: string
 *           example: "10"
 *       - in: query
 *         name: weight
 *         required: false
 *         schema:
 *           type: number
 *           example: 2.5
 *         description: Parcel weight in kilograms if carrier filtering depends on it
 *       - in: query
 *         name: carrier
 *         required: false
 *         schema:
 *           type: string
 *           example: "postnl"
 *     responses:
 *       200:
 *         description: Pickup points retrieved successfully
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
 *                     pickupPoints:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           addressLine1:
 *                             type: string
 *                           city:
 *                             type: string
 *                           postalCode:
 *                             type: string
 *                           country:
 *                             type: string
 *                           carrier:
 *                             type: string
 *                             nullable: true
 *                           distanceMeters:
 *                             type: number
 *                             nullable: true
 *                           latitude:
 *                             type: string
 *                             nullable: true
 *                           longitude:
 *                             type: string
 *                             nullable: true
 *                           openTomorrow:
 *                             type: boolean
 *                           openUpcomingWeek:
 *                             type: boolean
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get(
  '/pickup-points',
  authMiddleware,
  validateRequest(pickupPointsQueryValidator, 'query'),
  getPickupPoints
);

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
  createShipment,
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
router.get('/shipment/:orderId', authMiddleware, getShipmentStatus);

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
  getShippingLabel,
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
 * /api/shipping/methods-test:
 *   get:
 *     summary: Get available shipping methods (TEST - No Auth Required)
 *     tags: [Shipping]
 *     responses:
 *       200:
 *         description: Shipping methods retrieved
 */
router.get('/methods-test', getShippingMethods);

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
  cancelShipment,
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
router.get('/shipments', authMiddleware, adminMiddleware, getAllShipments);

/**
 * @swagger
 * /api/shipping/pickup-points:
 *   get:
 *     summary: Get Sendcloud pickup points (service points) near a postcode
 *     description: >
 *       Returns a list of available carrier pickup locations near the given postcode.
 *       Called by the Flutter checkout screen to populate the pickup-point picker
 *       before the user selects "Pickup Point" as delivery method.
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: postcode
 *         required: true
 *         schema:
 *           type: string
 *         description: Postal code to search around (e.g. SW1A1AA)
 *       - in: query
 *         name: courier
 *         required: false
 *         schema:
 *           type: string
 *         description: Carrier slug to filter results (e.g. dhl, ups, hermes). Omit for all carriers.
 *     responses:
 *       200:
 *         description: Pickup points retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     pickupPoints:
 *                       type: array
 *                       items:
 *                         type: object
 *                     count:
 *                       type: integer
 *       400:
 *         description: Missing postcode parameter
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/pickup-points', authMiddleware, getPickupPoints);

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
 *             required:
 *               - action
 *               - parcel
 *             properties:
 *               action:
 *                 type: string
 *                 example: "parcel_status_changed"
 *               timestamp:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *               parcel:
 *                 type: object
 *                 required:
 *                   - id
 *                 properties:
 *                   id:
 *                     type: number
 *                   tracking_number:
 *                     type: string
 *                     nullable: true
 *                   tracking_url:
 *                     type: string
 *                     nullable: true
 *                   status:
 *                     type: object
 *                     properties:
 *                       message:
 *                         type: string
 *     responses:
 *       200:
 *         description: Webhook received
 *       400:
 *         description: Invalid webhook payload
 */
router.post('/webhook', handleSendcloudWebhook);

export default router;
