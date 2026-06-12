import { Router } from 'express';
import { adminMiddleware } from '../../../shared/middleware/adminMiddleware';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import {
  getAllPostageSizes,
  updatePostageSize,
} from '../controllers/postageSizeController';
import {
  postageSizeIdValidator,
  postageSizeUpdateValidator,
} from '../validators/postageSizeValidator';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     PostageSize:
 *       type: object
 *       required:
 *         - id
 *         - description
 *         - size
 *         - type
 *         - weight
 *       properties:
 *         id:
 *           type: string
 *           description: Firestore document ID
 *           example: "4bVq7OrLNbLvCvuQ128h"
 *         description:
 *           type: string
 *           description: Human-readable guidance for this postage size
 *           example: "Large (Up to 2kg): Suitable for coats, boots, bulky clothing, or small bundles of items."
 *         size:
 *           type: string
 *           description: Postage size code
 *           example: "large"
 *         type:
 *           type: string
 *           description: Shipping provider or postage type
 *           example: "inpost"
 *         weight:
 *           type: integer
 *           description: Maximum parcel weight in grams
 *           example: 2000
 *         createdAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     UpdatePostageSize:
 *       type: object
 *       minProperties: 1
 *       properties:
 *         description:
 *           type: string
 *           example: "Large (Up to 2kg): Suitable for coats, boots, bulky clothing, or small bundles of items."
 *         size:
 *           type: string
 *           example: "large"
 *         type:
 *           type: string
 *           example: "inpost"
 *         weight:
 *           type: integer
 *           description: Maximum parcel weight in grams
 *           example: 2000
 */

/**
 * @swagger
 * tags:
 *   name: Postage Sizes
 *   description: Postage size and parcel weight configuration
 */

/**
 * @swagger
 * /api/postage-sizes:
 *   get:
 *     summary: Get all postage sizes
 *     tags: [Postage Sizes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Postage sizes fetched successfully
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
 *                   example: "Postage sizes fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PostageSize'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Failed to fetch postage sizes
 */
router.get('/', authMiddleware, getAllPostageSizes);

/**
 * @swagger
 * /api/postage-sizes/{id}:
 *   put:
 *     summary: Update a postage size
 *     description: Requires a Firebase user with the admin custom claim.
 *     tags: [Postage Sizes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Firestore postage_sizes document ID
 *         example: "4bVq7OrLNbLvCvuQ128h"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePostageSize'
 *     responses:
 *       200:
 *         description: Postage size updated successfully
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
 *                   example: "Postage size updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/PostageSize'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid ID or update payload
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Postage size not found
 *       500:
 *         description: Failed to update postage size
 */
router.put(
  '/:id',
  authMiddleware,
  adminMiddleware,
  validateRequest(postageSizeIdValidator, 'params'),
  validateRequest(postageSizeUpdateValidator),
  updatePostageSize,
);

export default router;
