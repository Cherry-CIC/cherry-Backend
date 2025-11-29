import { Router } from 'express';
import {
  getAllProducts,
  createProduct,
  getProductById,
  getProductWithDetails,
  getAllProductsWithDetails,
  updateProduct,
  deleteProduct,
  likeProduct,
  unlikeProduct,
  getLikedProducts
} from '../controllers/productController';
import { validateProduct } from '../validators/productValidator';
import { validateProductId } from '../validators/productIdValidator';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       required:
 *         - name
 *         - categoryId
 *         - charityId
 *         - quality
 *         - size
 *         - product_images
 *         - donation
 *         - price
 *         - number
 *       properties:
 *         id:
 *           type: string
 *           description: Auto-generated product ID
 *         name:
 *           type: string
 *           description: Product name
 *           example: "Smartphone"
 *         description:
 *           type: string
 *           description: Product description
 *           example: "Latest smartphone with advanced features"
 *         categoryId:
 *           type: string
 *           description: Reference to Category ID
 *           example: "KUnep4ttFUya4GNKx11T"
 *         charityId:
 *           type: string
 *           description: Reference to Charity ID
 *           example: "z1fLMUjUWlmkJn8y8UhU"
 *         quality:
 *           type: string
 *           description: Product quality rating
 *           example: "Premium"
 *         size:
 *           type: string
 *           description: Product size
 *           example: "Medium"
 *         product_images:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of product image URLs
 *           example: ["https://example.com/smartphone1.jpg", "https://example.com/smartphone2.jpg"]
 *         donation:
 *           type: number
 *           description: Donation amount
 *           example: 50.0
 *         price:
 *           type: number
 *           description: Product price
 *           example: 599.99
 *         likes:
 *           type: number
 *           description: Number of likes (deprecated - use likeCount)
 *           example: 0
 *         likeCount:
 *           type: number
 *           description: Total number of likes on this product
 *           example: 42
 *         isLikedByUser:
 *           type: boolean
 *           description: Whether the authenticated user has liked this product
 *           example: true
 *         number:
 *           type: number
 *           description: Product quantity/number
 *           example: 10
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: List of all products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Failed to fetch products"
 */
router.get('/', authMiddleware, getAllProducts);

/**
 * @swagger
 * /api/products/with-details:
 *   get:
 *     summary: Get all products with category and charity details
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: List of all products with populated category and charity details
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
 *                   example: "Products with details fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     allOf:
 *                       - $ref: '#/components/schemas/Product'
 *                       - type: object
 *                         properties:
 *                           category:
 *                             $ref: '#/components/schemas/Category'
 *                           charity:
 *                             $ref: '#/components/schemas/Charity'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 */
router.get('/with-details', authMiddleware, getAllProductsWithDetails);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     responses:
 *       200:
 *         description: Product found
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
 *                   example: "Product fetched successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid product ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Product ID must be between 3 and 50 characters"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Product not found"
 *                 error:
 *                   type: string
 *                   example: "Product with ID xyz does not exist"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to fetch product"
 *                 error:
 *                   type: string
 *                   example: "Database connection error"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/:id', authMiddleware, validateProductId, getProductById);

/**
 * @swagger
 * /api/products/{id}/with-details:
 *   get:
 *     summary: Get a product by ID with category and charity details
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     responses:
 *       200:
 *         description: Product found with populated category and charity details
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
 *                   example: "Product with details fetched successfully"
 *                 data:
 *                   type: object
 *                   allOf:
 *                     - $ref: '#/components/schemas/Product'
 *                     - type: object
 *                       properties:
 *                         category:
 *                           $ref: '#/components/schemas/Category'
 *                         charity:
 *                           $ref: '#/components/schemas/Charity'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid product ID
 *       404:
 *         description: Product not found
 *       500:
 *         description: Server error
 */
router.get('/:id/with-details', authMiddleware, validateProductId, getProductWithDetails);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - categoryId
 *               - charityId
 *               - quality
 *               - size
 *               - product_images
 *               - donation
 *               - price
 *               - number
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Smartphone"
 *               description:
 *                 type: string
 *                 example: "Latest smartphone with advanced features"
 *               categoryId:
 *                 type: string
 *                 example: "KUnep4ttFUya4GNKx11T"
 *               charityId:
 *                 type: string
 *                 example: "z1fLMUjUWlmkJn8y8UhU"
 *               quality:
 *                 type: string
 *                 example: "Premium"
 *               size:
 *                 type: string
 *                 example: "Medium"
 *               product_images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["https://example.com/smartphone1.jpg", "https://example.com/smartphone2.jpg"]
 *               donation:
 *                 type: number
 *                 example: 50.0
 *               price:
 *                 type: number
 *                 example: 599.99
 *               likes:
 *                 type: number
 *                 example: 0
 *               number:
 *                 type: number
 *                 example: 10
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "Product created"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "\"name\" is required"
 *       500:
 *         description: Server error
 */
router.post('/', authMiddleware, validateProduct, createProduct);

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Updated Smartphone"
 *               description:
 *                 type: string
 *                 example: "Updated smartphone with new features"
 *               categoryId:
 *                 type: string
 *                 example: "KUnep4ttFUya4GNKx11T"
 *               charityId:
 *                 type: string
 *                 example: "z1fLMUjUWlmkJn8y8UhU"
 *               quality:
 *                 type: string
 *                 example: "Premium"
 *               size:
 *                 type: string
 *                 example: "Large"
 *               product_images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["https://example.com/updated1.jpg"]
 *               donation:
 *                 type: number
 *                 example: 75.0
 *               price:
 *                 type: number
 *                 example: 699.99
 *               likes:
 *                 type: number
 *                 example: 5
 *               number:
 *                 type: number
 *                 example: 8
 *     responses:
 *       200:
 *         description: Product updated successfully
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
 *                   example: "Product updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error or invalid references
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Category not found"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Product not found"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 */
router.put('/:id', authMiddleware, validateProductId, validateProduct, updateProduct);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete a product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     responses:
 *       200:
 *         description: Product deleted successfully
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
 *                   example: "Product deleted successfully"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid product ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Product ID must be between 3 and 50 characters"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Product not found"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 */
router.delete('/:id', authMiddleware, validateProductId, deleteProduct);

/**
 * @swagger
 * /api/products/my-products:
 *   get:
 *     summary: Get current user's products
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's products fetched successfully
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
 *                   example: "User products fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /api/products/{id}/like:
 *   post:
 *     summary: Like a product (requires authentication)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     responses:
 *       200:
 *         description: Product liked successfully
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
 *                   example: "Product liked successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     likeCount:
 *                       type: integer
 *                       example: 42
 *                     isLikedByUser:
 *                       type: boolean
 *                       example: true
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Unlike a product (requires authentication)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *         example: "dePrjBhBLclqdWE0m9SP"
 *     responses:
 *       200:
 *         description: Product unliked successfully
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
 *                   example: "Product unliked successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     likeCount:
 *                       type: integer
 *                       example: 41
 *                     isLikedByUser:
 *                       type: boolean
 *                       example: false
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Product not found
 *       500:
 *         description: Server error
 */
router.post('/:id/like', authMiddleware, likeProduct);
router.delete('/:id/like', authMiddleware, unlikeProduct);

/**
 * @swagger
 * /api/products/user/liked:
 *   get:
 *     summary: Get all products liked by the authenticated user
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liked products fetched successfully
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
 *                   example: "Liked products fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Product'
 *                       - type: object
 *                         properties:
 *                           likeCount:
 *                             type: integer
 *                             example: 42
 *                           isLikedByUser:
 *                             type: boolean
 *                             example: true
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Server error
 */
router.get('/user/liked', authMiddleware, getLikedProducts);

export default router;

