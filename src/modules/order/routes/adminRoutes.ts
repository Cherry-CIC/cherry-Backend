import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { exportOrdersCsv } from '../controllers/exportController';

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

export default router;
