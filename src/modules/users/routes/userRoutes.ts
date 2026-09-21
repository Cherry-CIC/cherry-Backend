import { Router } from 'express';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateRequest } from '../../../shared/middleware/validateRequest';
import { getPublicProfile } from '../controllers/publicProfileController';
import {
  publicProfileParamsSchema,
  publicProfileQuerySchema,
} from '../validators/publicProfileValidator';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     PublicUser:
 *       type: object
 *       additionalProperties: false
 *       required: [id, username, profileImageUrl]
 *       properties:
 *         id:
 *           type: string
 *           minLength: 1
 *           description: The requested seller's Firebase UID.
 *           example: seller-firebase-uid
 *         username:
 *           type: string
 *           minLength: 1
 *           description: Chosen public username, or User when none exists. Private names are never used.
 *           example: Alex
 *         profileImageUrl:
 *           type: string
 *           nullable: true
 *           format: uri
 *           pattern: '^https?://'
 *           description: HTTP or HTTPS avatar without embedded credentials, or null.
 *           example: null
 *     PublicProfileProduct:
 *       type: object
 *       additionalProperties: false
 *       required: [id, userId, name, description, quality, product_images, donation, price, likes, number, size, postageSize, status, visibility]
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
 *         visibility:
 *           type: string
 *           enum: [public]
 *     PublicProfilePagination:
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
 *           description: Opaque cursor, or null on the final page. Bound to seller, viewer and public policy; expires after 24 hours.
 *         hasMore:
 *           type: boolean
 *           description: True only when another permitted listing exists and nextCursor is non-empty. False always means nextCursor is null.
 *     PublicProfileResponse:
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
 *           required: [user, products]
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/PublicUser'
 *             products:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PublicProfileProduct'
 *         meta:
 *           $ref: '#/components/schemas/PublicProfilePagination'
 *     PublicProfileError:
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
 * /api/users/{userId}/public-profile:
 *   get:
 *     summary: View another seller's public profile and available listings
 *     description: >-
 *       Requires a Firebase bearer ID token. Private account information is never returned.
 *       Only the requested seller's active, public, in-stock and permitted listings are returned.
 *       Legacy listings without visibility or moderation fields use active status plus positive stock;
 *       explicit restrictive or unknown publication states are excluded. Products use an explicit public allowlist.
 *       Ordering is createdAt descending, then Firestore document ID descending.
 *       The user is returned on every successful page, including an empty products array.
 *       Unavailable accounts all produce the same response. Operational failures remain retryable.
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
 *         description: Opaque nextCursor from this seller's previous page, for this authenticated viewer. Do not parse or modify it.
 *         schema:
 *           type: string
 *           minLength: 40
 *           maxLength: 4096
 *           pattern: '^[A-Za-z0-9_-]+$'
 *     responses:
 *       '200':
 *         description: Available public profile, including sellers with no available listings.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicProfileResponse'
 *             example:
 *               success: true
 *               data:
 *                 user: {id: seller-firebase-uid, username: Alex, profileImageUrl: null}
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
 *                     visibility: public
 *               meta: {limit: 20, nextCursor: null, hasMore: false}
 *       '400':
 *         description: Invalid identifier, page size, malformed, expired or incorrectly scoped cursor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicProfileError'
 *       '401':
 *         description: Missing or invalid Firebase bearer ID token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicProfileError'
 *       '403':
 *         description: Access denied by deployment access controls, where applicable.
 *       '404':
 *         description: This profile is unavailable. The account's internal state is never disclosed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicProfileError'
 *       '429':
 *         description: Too many requests when deployment rate limits apply. Honour Retry-After if present.
 *       '500':
 *         description: Temporary unexpected backend failure. Retry later.
 *       '503':
 *         description: Temporary authentication lookup, database, cursor configuration or scan-budget failure. Retry later.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicProfileError'
 */
router.get(
  '/:userId/public-profile',
  authMiddleware,
  validateRequest(publicProfileParamsSchema, 'params'),
  validateRequest(publicProfileQuerySchema, 'query'),
  getPublicProfile,
);

export default router;
