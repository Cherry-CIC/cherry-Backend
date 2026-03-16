import { Router } from 'express';
import {
    getAllCharities,
    getCharityById,
    createCharity,
    updateCharity,
    deleteCharity
} from '../controllers/charityController';
import { validateCharity, validateCharityUpdate } from '../validators/charityValidator';
import { validateCharityId } from '../validators/charityIdValidator';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Charity:
 *       type: object
 *       required:
 *         - name
 *         - description
 *         - imageUrl
 *       properties:
 *         id:
 *           type: string
 *           description: The auto-generated id of the charity
 *         name:
 *           type: string
 *           description: The name of the charity
 *         description:
 *           type: string
 *           description: A detailed description of the charity
 *         imageUrl:
 *           type: string
 *           format: uri
 *           description: The image URL of the charity
 *         website:
 *           type: string
 *           format: uri
 *           description: The website URL of the charity (optional)
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date the charity was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date the charity was last updated
 *       example:
 *         id: "charity123"
 *         name: "Red Cross"
 *         description: "The International Federation of Red Cross and Red Crescent Societies is a worldwide humanitarian aid organization."
 *         imageUrl: "https://example.com/redcross.jpg"
 *         website: "https://www.redcross.org"
 *         createdAt: "2023-01-01T00:00:00.000Z"
 *         updatedAt: "2023-01-01T00:00:00.000Z"
 */

/**
 * @swagger
 * tags:
 *   name: Charities
 *   description: Charity management
 */

/**
 * @swagger
 * /api/charities:
 *   get:
 *     summary: Get all charities
 *     tags: [Charities]
 *     responses:
 *       200:
 *         description: List of all charities
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
 *                     $ref: '#/components/schemas/Charity'
 */
router.get('/', getAllCharities);

/**
 * @swagger
 * /api/charities/{id}:
 *   get:
 *     summary: Get a charity by ID
 *     tags: [Charities]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The charity ID
 *     responses:
 *       200:
 *         description: Charity found
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
 *                   $ref: '#/components/schemas/Charity'
 *       404:
 *         description: Charity not found
 */
router.get('/:id', validateCharityId, getCharityById);

/**
 * @swagger
 * /api/charities:
 *   post:
 *     summary: Create a new charity
 *     tags: [Charities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *               - imageUrl
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *               website:
 *                 type: string
 *                 format: uri
 *             example:
 *               name: "UNICEF"
 *               description: "UNICEF works in over 190 countries and territories to save children's lives, to defend their rights, and to help them fulfill their potential."
 *               imageUrl: "https://example.com/unicef.jpg"
 *               website: "https://www.unicef.org"
 *     responses:
 *       201:
 *         description: Charity created successfully
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
 *                   $ref: '#/components/schemas/Charity'
 *       400:
 *         description: Validation error
 */
router.post('/', validateCharity, createCharity);

/**
 * @swagger
 * /api/charities/{id}:
 *   put:
 *     summary: Update a charity
 *     tags: [Charities]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The charity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *               website:
 *                 type: string
 *                 format: uri
 *             example:
 *               name: "Updated UNICEF"
 *               description: "Updated description for UNICEF's mission and activities worldwide."
 *               imageUrl: "https://example.com/updated-unicef.jpg"
 *               website: "https://www.unicef.org"
 *     responses:
 *       200:
 *         description: Charity updated successfully
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
 *                   $ref: '#/components/schemas/Charity'
 *       404:
 *         description: Charity not found
 *       400:
 *         description: Validation error
 */
router.put('/:id', validateCharityId, validateCharityUpdate, updateCharity);

/**
 * @swagger
 * /api/charities/{id}:
 *   delete:
 *     summary: Delete a charity
 *     tags: [Charities]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The charity ID
 *     responses:
 *       200:
 *         description: Charity deleted successfully
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
 *                   type: null
 *       404:
 *         description: Charity not found
 */
router.delete('/:id', validateCharityId, deleteCharity);

export default router;