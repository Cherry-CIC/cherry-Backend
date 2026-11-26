import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import { sendTestResendEmail } from '../controllers/notificationController';
import { registerPushDevice, removePushDevice } from '../controllers/pushController';
import { registerDeviceSchema, removeDeviceSchema, testResendEmailSchema } from '../validators/notificationValidator';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: Mobile notification devices and internal email testing
 */

/**
 * @swagger
 * /api/notifications/test-resend:
 *   post:
 *     summary: "[TEST ONLY] Send a Resend test email"
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 example: "delivered@resend.dev"
 *     responses:
 *       200:
 *         description: Test email sent or skipped
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Resend send failed
 */
router.post(
  '/test-resend',
  authMiddleware,
  validateRequest(testResendEmailSchema),
  sendTestResendEmail,
);

/**
 * @swagger
 * /api/notifications/devices:
 *   post:
 *     summary: Register or refresh the signed-in buyer's mobile push device
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, platform]
 *             properties:
 *               token: { type: string, maxLength: 4096 }
 *               platform: { type: string, enum: [ios, android] }
 *     responses:
 *       200: { description: Device registered }
 *       400: { description: Invalid request }
 *       401: { description: Authentication required }
 *       404: { description: Buyer profile missing }
 *       429: { description: Device limit reached }
 *       503: { description: Collection notifications are disabled }
 *   delete:
 *     summary: Remove this mobile push token before signing out
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, maxLength: 4096 }
 *     responses:
 *       200: { description: Device deregistered or already absent }
 *       400: { description: Invalid request }
 *       401: { description: Authentication required }
 */
router.post('/devices', authMiddleware, validateRequest(registerDeviceSchema), registerPushDevice);
router.delete('/devices', authMiddleware, validateRequest(removeDeviceSchema), removePushDevice);

export default router;
