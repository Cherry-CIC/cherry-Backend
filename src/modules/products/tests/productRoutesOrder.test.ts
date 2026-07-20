import express from 'express';
import request from 'supertest';

const mockGetProductById = jest.fn((req, res) => {
  res.status(200).json({ handler: 'getProductById', id: req.params.id });
});
const mockGetMyProducts = jest.fn((_req, res) => {
  res.status(200).json({ handler: 'getMyProducts' });
});
const mockGetMyLikedProducts = jest.fn((_req, res) => {
  res.status(200).json({ handler: 'getMyLikedProducts' });
});

jest.mock('../../../shared/middleware/authMiddleWare', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { uid: 'user-1' };
    next();
  },
}));

jest.mock('../../../shared/middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../validators/productIdValidator', () => ({
  validateProductId: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../validators/productValidator', () => ({
  productListQuerySchema: {},
  validateProduct: (_req: any, _res: any, next: any) => next(),
  validateProductUpdate: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../controllers/productController', () => ({
  getAllProducts: jest.fn((_req, res) => res.status(200).json({ handler: 'getAllProducts' })),
  createProduct: jest.fn((_req, res) => res.status(201).json({ handler: 'createProduct' })),
  getProductById: mockGetProductById,
  getProductWithDetails: jest.fn((_req, res) => res.status(200).json({ handler: 'getProductWithDetails' })),
  getAllProductsWithDetails: jest.fn((_req, res) => res.status(200).json({ handler: 'getAllProductsWithDetails' })),
  getMyProducts: mockGetMyProducts,
  getMyLikedProducts: mockGetMyLikedProducts,
  updateProduct: jest.fn((_req, res) => res.status(200).json({ handler: 'updateProduct' })),
  deleteProduct: jest.fn((_req, res) => res.status(200).json({ handler: 'deleteProduct' })),
  likeProduct: jest.fn((_req, res) => res.status(200).json({ handler: 'likeProduct' })),
}));

const productRoutes = require('../routes/productRoutes').default;

describe('product route ordering', () => {
  const app = express();
  app.use('/api/products', productRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes /my-products before the generic product id route', async () => {
    const res = await request(app).get('/api/products/my-products');

    expect(res.statusCode).toBe(200);
    expect(res.body.handler).toBe('getMyProducts');
    expect(mockGetMyProducts).toHaveBeenCalledTimes(1);
    expect(mockGetProductById).not.toHaveBeenCalled();
  });

  it('routes /my-liked-items before the generic product id route', async () => {
    const res = await request(app).get('/api/products/my-liked-items');

    expect(res.statusCode).toBe(200);
    expect(res.body.handler).toBe('getMyLikedProducts');
    expect(mockGetMyLikedProducts).toHaveBeenCalledTimes(1);
    expect(mockGetProductById).not.toHaveBeenCalled();
  });
});
