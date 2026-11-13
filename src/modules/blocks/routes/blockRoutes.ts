import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import {
  blockCharity,
  blockUser,
  listBlockedCharities,
  listBlockedUsers,
  unblockCharity,
  unblockUser,
} from '../controllers/blockController';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Blocks
 *   description: User-managed blocking controls
 */

/**
 * @swagger
 * /api/blocks:
 *   get:
 *     summary: List users blocked by the authenticated user
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Blocked users fetched
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to fetch blocked users
 */
router.get('/', authMiddleware, listBlockedUsers);

/**
 * @swagger
 * /api/blocks/{userId}:
 *   post:
 *     summary: Block a user
 *     description: >
 *       Blocks another user for the authenticated viewer. Blocked sellers are
 *       hidden from this viewer's user-product pages. Users cannot block
 *       themselves.
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 128
 *         description: Firebase UID to block. Path separators, control characters, dot identifiers and deleted_user are invalid.
 *     responses:
 *       200:
 *         description: User blocked
 *       400:
 *         description: Invalid user to block or self-block attempt
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to block user
 *   delete:
 *     summary: Unblock a user
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 128
 *         description: Firebase UID to unblock. Path separators, control characters, dot identifiers and deleted_user are invalid.
 *     responses:
 *       200:
 *         description: User unblocked
 *       400:
 *         description: Invalid user to unblock
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to unblock user
 */
/**
 * @swagger
 * /api/blocks/charities:
 *   get:
 *     summary: List charities blocked by the authenticated user
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Blocked charities fetched
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to fetch blocked charities
 */
router.get('/charities', authMiddleware, listBlockedCharities);

/**
 * @swagger
 * /api/blocks/charities/{charityId}:
 *   post:
 *     summary: Block a charity
 *     description: >
 *       Blocks a charity for the authenticated viewer. Blocked charities'
 *       listings are hidden from the viewer's charity profile product endpoint.
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: charityId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 128
 *         description: Charity ID to block. Path separators, control characters, and dot identifiers are invalid.
 *     responses:
 *       200:
 *         description: Charity blocked
 *       400:
 *         description: Invalid charity to block
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to block charity
 *   delete:
 *     summary: Unblock a charity
 *     tags: [Blocks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: charityId
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 128
 *         description: Charity ID to unblock. Path separators, control characters, and dot identifiers are invalid.
 *     responses:
 *       200:
 *         description: Charity unblocked
 *       400:
 *         description: Invalid charity to unblock
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to unblock charity
 */
router.post('/charities/:charityId', authMiddleware, blockCharity);
router.delete('/charities/:charityId', authMiddleware, unblockCharity);

router.post('/:userId', authMiddleware, blockUser);
router.delete('/:userId', authMiddleware, unblockUser);

export default router;
