import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { exportOrdersCsv } from '../controllers/exportController';
import {
	getAdminDisputeDetails,
	getAdminDisputeDetailsByOrderId,
	getAdminDisputeSummary,
	listAdminDisputes,
	moderateAdminDispute,
} from '../../../disputes/DisputeAdminController';
import {
	getAdminReport,
	listAdminReports,
	updateAdminReportStatus,
} from '../../reports/controllers/reportController';
import {
	moderateProduct,
	moderateUser,
} from '../../moderation/controllers/moderationController';

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
 *                 enum: [in_progress, resolved]
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

/**
 * @swagger
 * /api/admin/reports:
 *   get:
 *     summary: List user-submitted reports
 *     description: Returns the admin moderation report queue ordered by newest first.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, reviewing, resolved, rejected]
 *         description: Optional report status filter.
 *       - in: query
 *         name: targetType
 *         schema:
 *           type: string
 *           enum: [product, user]
 *         description: Optional target type filter.
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
 *         description: Report ID returned as nextCursor by the previous page.
 *     responses:
 *       200:
 *         description: Reports fetched
 *       400:
 *         description: Invalid report query or cursor
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Failed to fetch reports
 */
router.get('/reports', authMiddleware, adminMiddleware, listAdminReports);

/**
 * @swagger
 * /api/admin/reports/{reportId}:
 *   get:
 *     summary: Get a report by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *         description: Firestore report document ID.
 *     responses:
 *       200:
 *         description: Report fetched
 *       400:
 *         description: Report ID is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Report not found
 *       500:
 *         description: Failed to fetch report
 */
router.get('/reports/:reportId', authMiddleware, adminMiddleware, getAdminReport);

/**
 * @swagger
 * /api/admin/reports/{reportId}/status:
 *   patch:
 *     summary: Update a report review status
 *     description: >
 *       Moves a user-submitted report through the admin review workflow. Setting
 *       status to `resolved` or `rejected` records the resolving admin and time.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [open, reviewing, resolved, rejected]
 *                 example: reviewing
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *                 example: Reviewing seller history before action.
 *     responses:
 *       200:
 *         description: Report updated
 *       400:
 *         description: Invalid report status update
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Report not found
 *       500:
 *         description: Failed to update report
 */
router.patch(
	'/reports/:reportId/status',
	authMiddleware,
	adminMiddleware,
	updateAdminReportStatus,
);

/**
 * @swagger
 * /api/admin/moderation/products/{productId}:
 *   patch:
 *     summary: Hide or restore a product listing
 *     description: >
 *       Applies admin moderation to a product. Hidden products are excluded from
 *       public product browsing and detail views, while remaining visible to the
 *       owner in their own listings.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, reason]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [hide, restore]
 *                 example: hide
 *               reason:
 *                 type: string
 *                 example: prohibited_item
 *     responses:
 *       200:
 *         description: Product moderation saved
 *       400:
 *         description: Invalid product moderation request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Failed to moderate product
 */
router.patch(
	'/moderation/products/:productId',
	authMiddleware,
	adminMiddleware,
	moderateProduct,
);

/**
 * @swagger
 * /api/admin/moderation/users/{userId}:
 *   patch:
 *     summary: Warn, suspend, or restore a user
 *     description: >
 *       Applies admin moderation to a user. `suspend` disables the Firebase Auth
 *       user and marks the Firestore profile suspended when present. `restore`
 *       re-enables the Firebase Auth user and marks the profile active when
 *       present. `warn` records warning metadata on the Firestore user profile.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Firebase UID to moderate.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, reason]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [warn, suspend, restore]
 *                 example: suspend
 *               reason:
 *                 type: string
 *                 example: repeated_abuse
 *     responses:
 *       200:
 *         description: User moderation saved
 *       400:
 *         description: Invalid user moderation request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to moderate user
 */
router.patch(
	'/moderation/users/:userId',
	authMiddleware,
	adminMiddleware,
	moderateUser,
);

export default router;
