import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { exportOrdersCsv } from '../controllers/exportController';
import {
	claimAdminDispute,
	getAdminDisputeDetails,
	getAdminDisputeDetailsByOrderId,
	getAdminDisputeSummary,
	listAdminDisputes,
	moderateAdminDispute,
} from '../../../disputes/DisputeAdminController';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin-only operations for export and reporting
 */

/**
 * @swagger
 * /api/admin/export/orders:
 *   get:
 *     summary: Export orders as CSV within a date range (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-01-01"
 *         description: Start date in YYYY-MM-DD format (inclusive)
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
 *         description: End date in YYYY-MM-DD format (inclusive)
 *     responses:
 *       200:
 *         description: CSV export generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "CSV export generated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: Signed URL to download the CSV file (valid for 1 hour)
 *                     filename:
 *                       type: string
 *                       description: Name of the exported file
 *                     recordCount:
 *                       type: integer
 *                       description: Number of orders included in the export
 *                     dateRange:
 *                       type: object
 *                       properties:
 *                         start:
 *                           type: string
 *                         end:
 *                           type: string
 *                     expiresIn:
 *                       type: string
 *                       example: "1 hour"
 *       400:
 *         description: Bad request - Invalid or missing parameters
 *       401:
 *         description: Unauthorized - Authentication required
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/export/orders', authMiddleware, adminMiddleware, exportOrdersCsv);

/**
 * @swagger
 * /api/admin/disputes/summary:
 *   get:
 *     summary: Get dispute counts by moderation status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dispute totals and per-status counts
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get(
	'/disputes/summary',
	authMiddleware,
	adminMiddleware,
	getAdminDisputeSummary,
);

/**
 * @swagger
 * /api/admin/disputes:
 *   get:
 *     summary: List disputes for the admin moderation queue
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [raised, in_progress, resolved]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Dispute ID returned as nextCursor by the previous page
 *     responses:
 *       200:
 *         description: Dispute page with hasMore and nextCursor
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/disputes', authMiddleware, adminMiddleware, listAdminDisputes);

/**
 * @swagger
 * /api/admin/disputes/{disputeId}/claim:
 *   post:
 *     summary: Claim an unassigned dispute for the authenticated administrator
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dispute assigned to this administrator and moved to in_progress
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Dispute not found
 *       409:
 *         description: Dispute is already claimed or not available to claim
 */
router.post(
	'/disputes/:disputeId/claim',
	authMiddleware,
	adminMiddleware,
	claimAdminDispute,
);

/**
 * @swagger
 * /api/admin/disputes/by-order/{orderId}:
 *   get:
 *     summary: Get dispute detail and audit events by associated order ID
 *     tags: [Admin]
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
 *         description: Dispute and chronological event history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: No dispute exists for this order
 */
router.get(
	'/disputes/by-order/:orderId',
	authMiddleware,
	adminMiddleware,
	getAdminDisputeDetailsByOrderId,
);

/**
 * @swagger
 * /api/admin/disputes/{disputeId}:
 *   get:
 *     summary: Get dispute detail and audit events
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dispute and chronological event history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Dispute not found
 */
router.get(
	'/disputes/:disputeId',
	authMiddleware,
	adminMiddleware,
	getAdminDisputeDetails,
);

/**
 * @swagger
 * /api/admin/disputes/{disputeId}/status:
 *   patch:
 *     summary: Change dispute status and append an admin audit event
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 128
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [resolved]
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Dispute status updated
 *       400:
 *         description: Invalid request, missing idempotency key, or resolution explanation
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Dispute not found
 *       409:
 *         description: Invalid status transition or key reused with a different request
 */
router.patch(
	'/disputes/:disputeId/status',
	authMiddleware,
	adminMiddleware,
	moderateAdminDispute,
);

export default router;
