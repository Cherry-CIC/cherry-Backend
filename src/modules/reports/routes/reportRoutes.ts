import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { createReport } from '../controllers/reportController';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: User-submitted product and user reports
 */

/**
 * @swagger
 * /api/reports:
 *   post:
 *     summary: Report a product or user
 *     description: >
 *       Creates a moderation report from the authenticated user. Product reports
 *       use targetType `product`; seller/user reports use targetType `user`.
 *       Users cannot report themselves.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetType, targetId, reason]
 *             properties:
 *               targetType:
 *                 type: string
 *                 enum: [product, user]
 *                 example: product
 *               targetId:
 *                 type: string
 *                 description: Product ID or Firebase UID being reported.
 *                 example: product_123
 *               reason:
 *                 type: string
 *                 maxLength: 100
 *                 example: misleading_listing
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *                 example: The photos do not match the item description.
 *     responses:
 *       201:
 *         description: Report submitted
 *       400:
 *         description: Invalid report details or self-report attempt
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to submit report
 */
router.post('/', authMiddleware, createReport);

export default router;
