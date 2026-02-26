import { Router } from 'express';
import {
    register,
    login,
    getProfile,
    updateProfile,
    syncProfile
} from '../controllers/authController';
import { validateRegister, validateLogin } from '../validators/authValidator';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - firebaseUid
 *         - email
 *         - displayName
 *       properties:
 *         id:
 *           type: string
 *           description: The auto-generated id of the user
 *         firebaseUid:
 *           type: string
 *           description: The Firebase Auth UID
 *         email:
 *           type: string
 *           format: email
 *           description: The user's email address
 *         displayName:
 *           type: string
 *           description: The user's display name
 *         photoURL:
 *           type: string
 *           format: uri
 *           description: The user's profile picture URL
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date the user was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date the user was last updated
 *       example:
 *         id: "user123"
 *         firebaseUid: "firebase-uid-123"
 *         email: "user@example.com"
 *         displayName: "John Doe"
 *         photoURL: "https://example.com/photo.jpg"
 *         createdAt: "2023-01-01T00:00:00.000Z"
 *         updatedAt: "2023-01-01T00:00:00.000Z"
 *     
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/User'
 *         token:
 *           type: string
 *           description: JWT token for authentication
 *       example:
 *         user:
 *           id: "user123"
 *           firebaseUid: "firebase-uid-123"
 *           email: "user@example.com"
 *           displayName: "John Doe"
 *         token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 */

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User authentication and profile management
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - displayName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               displayName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               photoURL:
 *                 type: string
 *                 format: uri
 *             example:
 *               email: "user@example.com"
 *               password: "password123"
 *               displayName: "John Doe"
 *               photoURL: "https://example.com/photo.jpg"
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                   $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error or invalid input
 *       409:
 *         description: Email already exists
 */
router.post('/register', validateRegister, register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *             example:
 *               email: "user@example.com"
 *               password: "password123"
 *     responses:
 *       200:
 *         description: Login successful
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
 *                   $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 *       404:
 *         description: User not found
 */
router.post('/login', validateLogin, login);

/**
 * @swagger
 * /api/auth/sync:
 *   get:
 *     summary: Synchronize user profile from Firebase token
 *     description: |
 *       Used after social login (Apple/Google). Checks if user profile exists in database.
 *       If not, it creates it using the data available in the Firebase ID token.
 *       This avoids asking the user for their email a second time if Apple/Google already provided it.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile synchronized (existed already)
 *       201:
 *         description: Profile created from token data
 *       401:
 *         description: Unauthorized
 */
router.get('/sync', authMiddleware, syncProfile);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile fetched successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User profile not found
 */
router.get('/profile', authMiddleware, getProfile);

/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               photoURL:
 *                 type: string
 *                 format: uri
 *             example:
 *               displayName: "John Smith"
 *               photoURL: "https://example.com/new-photo.jpg"
 *     responses:
 *       200:
 *         description: User profile updated successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User profile not found
 */
router.put('/profile', authMiddleware, updateProfile);

export default router;
