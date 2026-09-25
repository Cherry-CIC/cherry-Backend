import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import {
  getUserProducts,
  getUserProfile,
} from '../controllers/userProfileController';
import {
  userIdParamsSchema,
  userProductsQuerySchema,
} from '../validators/userProfileValidator';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfile:
 *       type: object
 *       additionalProperties: false
 *       required: [id, username, profileImageUrl]
 *       properties:
 *         id:
 *           type: string
 *           minLength: 1
 *           description: The requested user's Firebase UID.
 *           example: seller-firebase-uid
 *         username:
 *           type: string
 *           minLength: 1
 *           description: Chosen username, or User when none exists. Private names are never used.
 *           example: Alex
 *         profileImageUrl:
 *           type: string
 *           nullable: true
 *           format: uri
 *           pattern: '^https?://'
 *           description: HTTP or HTTPS avatar without embedded credentials, or null.
 *           example: null
 *     UserProduct:
 *       type: object
 *       additionalProperties: false
 *       required: [id, userId, name, description, quality, product_images, donation, price, securityFee, likes, number, size, postageSize, status]
 *       properties:
 *         id:
 *           type: string
 *           minLength: 1
 *         userId:
 *           type: string
 *           minLength: 1
 *         name:
 *           type: string
 *           minLength: 1
 *         description:
 *           type: string
 *         quality:
 *           type: string
 *           minLength: 1
 *         product_images:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *             pattern: '^https?://'
 *         donation:
 *           type: number
 *           minimum: 0
 *           description: Stored donation amount in GBP.
 *         price:
 *           type: number
 *           minimum: 0
 *           description: Stored listing price in GBP.
 *         securityFee:
 *           type: number
 *           minimum: 0
 *           description: Existing checkout security-fee calculation in GBP.
 *         likes:
 *           type: integer
 *           minimum: 0
 *         number:
 *           type: integer
 *           minimum: 1
 *         size:
 *           type: string
 *           minLength: 1
 *         postageSize:
 *           type: string
 *           minLength: 1
 *         categoryId:
 *           type: string
 *         charityId:
 *           type: string
 *         status:
 *           type: string
 *           enum: [active]
 *     UserProductsPagination:
 *       type: object
 *       additionalProperties: false
 *       required: [limit, nextCursor, hasMore]
 *       properties:
 *         limit:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         nextCursor:
 *           type: string
 *           nullable: true
 *           description: Opaque cursor, or null on the final page. Bound to user, viewer and product policy; expires after 24 hours.
 *         hasMore:
 *           type: boolean
 *           description: True only when another eligible product exists and nextCursor is non-empty. False always means nextCursor is null.
 *     UserProfileResponse:
 *       type: object
 *       additionalProperties: false
 *       required: [success, data]
 *       properties:
 *         success:
 *           type: boolean
 *           enum: [true]
 *         data:
 *           $ref: '#/components/schemas/UserProfile'
 *     UserProductsResponse:
 *       type: object
 *       additionalProperties: false
 *       required: [success, data, meta]
 *       properties:
 *         success:
 *           type: boolean
 *           enum: [true]
 *         data:
 *           type: object
 *           additionalProperties: false
 *           required: [products]
 *           properties:
 *             products:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UserProduct'
 *         meta:
 *           $ref: '#/components/schemas/UserProductsPagination'
 *     UserProfileError:
 *       type: object
 *       required: [success, message, timestamp]
 *       properties:
 *         success:
 *           type: boolean
 *           enum: [false]
 *         message:
 *           type: string
 *         error:
 *           type: string
 *           description: Safe validation or authentication summary, when present.
 *         timestamp:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/users/{userId}/profile:
 *   get:
 *     summary: View another user's safe profile
 *     description: >-
 *       Requires a Firebase bearer ID token. This is separate from
 *       /api/auth/profile, which returns the authenticated user's own account
 *       profile. Private account information is never returned here.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         description: Firebase UID, trimmed, at most 128 characters. Path separators, control characters, dot identifiers and deleted_user are invalid.
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 128
 *         example: seller-firebase-uid
 *     responses:
 *       '200':
 *         description: Available user profile.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileResponse'
 *             example:
 *               success: true
 *               data: {id: seller-firebase-uid, username: Alex, profileImageUrl: null}
 *       '400':
 *         description: Invalid identifier.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '401':
 *         description: Missing or invalid Firebase bearer ID token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '404':
 *         description: This profile is unavailable. The account's internal state is never disclosed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '503':
 *         description: Temporary authentication lookup or database failure. Retry later.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 */
router.get(
  '/:userId/profile',
  authMiddleware,
  validateRequest(userIdParamsSchema, 'params'),
  getUserProfile,
);

/**
 * @swagger
 * /api/users/{userId}/products:
 *   get:
 *     summary: View another user's visible products
 *     description: >-
 *       Requires a Firebase bearer ID token. Only the requested user's active,
 *       in-stock and permitted listings are returned. Legacy listings with a
 *       missing status remain eligible when they have positive stock; explicit
 *       restrictive or unknown states are excluded. Products use an explicit
 *       safe-field allowlist. Ordering is createdAt descending, then Firestore
 *       document ID descending.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         description: Firebase UID, trimmed, at most 128 characters. Path separators, control characters, dot identifiers and deleted_user are invalid.
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 128
 *         example: seller-firebase-uid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *       - in: query
 *         name: cursor
 *         description: Opaque nextCursor from this user's previous products page, for this authenticated viewer. Do not parse or modify it.
 *         schema:
 *           type: string
 *           minLength: 40
 *           maxLength: 4096
 *           pattern: '^[A-Za-z0-9_-]+$'
 *     responses:
 *       '200':
 *         description: Visible products, including users with no available products.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProductsResponse'
 *             example:
 *               success: true
 *               data:
 *                 products:
 *                   - id: listing-id
 *                     userId: seller-firebase-uid
 *                     name: Blue cotton shirt
 *                     description: A pre-loved cotton shirt in good condition.
 *                     quality: Good
 *                     product_images: ['https://example.org/listing.jpg']
 *                     donation: 10
 *                     price: 10
 *                     securityFee: 1
 *                     likes: 0
 *                     number: 1
 *                     size: M
 *                     postageSize: small-parcel-id
 *                     categoryId: shirts-id
 *                     charityId: charity-id
 *                     status: active
 *               meta: {limit: 20, nextCursor: null, hasMore: false}
 *       '400':
 *         description: Invalid identifier, page size, malformed, expired or incorrectly scoped cursor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '401':
 *         description: Missing or invalid Firebase bearer ID token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '404':
 *         description: This profile is unavailable. The account's internal state is never disclosed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 *       '503':
 *         description: Temporary authentication lookup, database, cursor configuration or scan-budget failure. Retry later.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileError'
 */
router.get(
  '/:userId/products',
  authMiddleware,
  validateRequest(userIdParamsSchema, 'params'),
  validateRequest(userProductsQuerySchema, 'query'),
  getUserProducts,
);

export default router;
