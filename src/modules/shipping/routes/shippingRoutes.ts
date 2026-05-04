import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import {
  createTestParcel,
  getCheckoutShippingOptions,
  getPickupPoints,
  handleSendcloudWebhook,
  validatePostcode,
} from '../controllers/shippingController';
import {
  checkoutShippingOptionsQueryValidator,
  createTestParcelValidator,
  postcodeValidationQueryValidator,
  pickupPointsQueryValidator,
} from '../validators/shippingValidator';

const router = Router();

/**
 * @swagger
 * /api/shipping/shipping-methods:
 *   get:
 *     summary: Get shipping methods for selected service point
 *     tags: [Shipping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: servicePointId
 *         required: true
 *         schema:
 *           type: string
 *           example: "12345678"
 *         description: Selected service point id (locker id)
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
 *           example: "SE18 4QH"
 *         description: Destination postal code
 *       - in: query
 *         name: isReturn
 *         required: false
 *         schema:
 *           type: boolean
 *           example: false
 *         description: Optional return-method lookup flag
 *     responses:
 *       200:
 *         description: Shipping methods retrieved successfully
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
 *                     shippingMethods:
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
 *                             enum: [pickup_point]
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
  '/shipping-methods',
  authMiddleware,
  validateRequest(checkoutShippingOptionsQueryValidator, 'query'),
  getCheckoutShippingOptions
);

/**
 * @swagger
 * /api/shipping/pickup-points:
 *   get:
 *     summary: Get available InPost pickup points for a destination
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
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           example: "SE18 4QH"
 *         description: Free-text address or postcode used for service-point lookup.
 *       - in: query
 *         name: radius
 *         required: false
 *         schema:
 *           type: integer
 *           example: 5000
 *         description: Search radius in meters for address/postcode geocoding. Default 5000.
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
 * /api/shipping/postcodes/validate:
 *   get:
 *     summary: Validate postcode and return normalized location fields
 *     tags: [Shipping]
 *     parameters:
 *       - in: query
 *         name: postcode
 *         required: true
 *         schema:
 *           type: string
 *           example: "SW1A 2AA"
 *         description: UK postcode to validate.
 *     responses:
 *       200:
 *         description: Postcode validated successfully
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
 *                     postcode:
 *                       type: object
 *                       properties:
 *                         postcode:
 *                           type: string
 *                         city:
 *                           type: string
 *                         region:
 *                           type: string
 *                         country:
 *                           type: string
 *                         adminDistrict:
 *                           type: string
 *                         latitude:
 *                           type: number
 *                           nullable: true
 *                         longitude:
 *                           type: number
 *                           nullable: true
 *       400:
 *         description: Invalid postcode
 *       500:
 *         description: Internal server error
 */
router.get(
  '/postcodes/validate',
  validateRequest(postcodeValidationQueryValidator, 'query'),
  validatePostcode,
);

/**
 * @swagger
 * /api/shipping/test-create-parcel:
 *   post:
 *     summary: "[TEST ONLY - DO NOT USE IN APP FLOW] Create Sendcloud parcel directly"
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
 *               - parcel
 *             properties:
 *               parcel:
 *                 type: object
 *                 required:
 *                   - name
 *                   - address
 *                   - house_number
 *                   - city
 *                   - postal_code
 *                   - country
 *                   - email
 *                   - telephone
 *                   - request_label
 *                   - shipment
 *                   - to_service_point
 *                   - weight
 *                   - order_number
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: "John Doe"
 *                   address:
 *                     type: string
 *                     example: "18 Calderwood Street"
 *                   house_number:
 *                     type: string
 *                     example: "18"
 *                   city:
 *                     type: string
 *                     example: "London"
 *                   postal_code:
 *                     type: string
 *                     example: "SE18 5AB"
 *                   country:
 *                     type: string
 *                     example: "GB"
 *                   email:
 *                     type: string
 *                     example: "sol@gmail.com"
 *                   telephone:
 *                     type: string
 *                     example: "+447700900000"
 *                   request_label:
 *                     type: boolean
 *                     example: false
 *                   shipment:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 3747
 *                   to_service_point:
 *                     type: integer
 *                     example: 13127548
 *                   weight:
 *                     oneOf:
 *                       - type: string
 *                       - type: number
 *                     example: "2.5"
 *                   order_number:
 *                     type: string
 *                     example: "ORDER-123"
 *     responses:
 *       200:
 *         description: Test parcel created successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post(
  '/test-create-parcel',
  authMiddleware,
  validateRequest(createTestParcelValidator),
  createTestParcel,
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
