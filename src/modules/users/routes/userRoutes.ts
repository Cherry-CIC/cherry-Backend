import { Router } from 'express';
import { deleteMe, requestDeletionQueue, triggerScheduledDeletions } from '../controllers/userController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profile and account management
 */

/**
 * @swagger
 * /api/users/me:
 *   delete:
 *     summary: Attempts immediate account deletion
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Deletion completed successfully (no content)
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Not Found - User profile record not found
 *       409:
 *         description: Conflict - Deletion blocked by outstanding tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "blocked"
 *                 reason:
 *                   type: string
 *                   example: "outstanding_tasks"
 *                 canQueueDeletion:
 *                   type: boolean
 *                   example: true
 *                 blockingItems:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["pending_shipment", "active_order"]
 *                 message:
 *                   type: string
 *                   example: "Your account cannot be deleted yet because there are outstanding tasks."
 *       500:
 *         description: Internal server error
 */
router.delete('/me', authMiddleware, deleteMe);

/**
 * @swagger
 * /api/users/me/deletion-request:
 *   post:
 *     summary: Queues deletion request if blockers exist
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Deletion has been queued (Accepted)
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
 *                   example: "Deletion request queued successfully. Deletion will proceed once all outstanding tasks are resolved."
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Not Found - User profile record not found
 *       500:
 *         description: Internal server error
 */
router.post('/me/deletion-request', authMiddleware, requestDeletionQueue);

/**
 * @swagger
 * /api/users/process-deletions:
 *   post:
 *     summary: Triggers processing of queued/scheduled deletions (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Max number of profiles to process
 *     responses:
 *       200:
 *         description: Scheduled deletions processed successfully
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
 *                   example: "Scheduled deletions processed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     processed:
 *                       type: integer
 *                       example: 1
 *                     deleted:
 *                       type: integer
 *                       example: 1
 *       401:
 *         description: Unauthorized - Authentication required
 *       403:
 *         description: Forbidden - Admin privileges required
 *       500:
 *         description: Internal server error
 */
router.post('/process-deletions', authMiddleware, adminMiddleware, triggerScheduledDeletions);

export default router;
