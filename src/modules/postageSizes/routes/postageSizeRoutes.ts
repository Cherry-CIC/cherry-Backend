import { Router } from 'express';
import { getAllPostageSizes } from '../controllers/postageSizeController';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     PostageSize:
 *       type: object
 *       required:
 *         - id
 *         - type
 *         - size
 *         - description
 *       properties:
 *         id:
 *           type: string
 *           description: Firestore document ID for the postage size
 *         type:
 *           type: string
 *           description: Fulfilment type for the postage size
 *           example: "inpost"
 *         size:
 *           type: string
 *           enum: [small, medium, large]
 *           example: "small"
 *         description:
 *           type: string
 *           description: User-facing guidance for this postage size
 */

/**
 * @swagger
 * tags:
 *   name: Postage Sizes
 *   description: Public postage size reference data
 */

/**
 * @swagger
 * /api/postage-sizes:
 *   get:
 *     summary: Get postage sizes
 *     tags: [Postage Sizes]
 *     responses:
 *       200:
 *         description: List of postage sizes
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PostageSize'
 *       500:
 *         description: Failed to fetch postage sizes
 */
router.get('/', getAllPostageSizes);

export default router;
