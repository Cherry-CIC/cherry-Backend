import express from 'express';
import request from 'supertest';
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: () => ({
      updateProduct: mockUpdate,
      getProductById: mockGet,
    }),
  },
}));
jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: () => ({
      verifyIdToken: async (token: string) => {
        if (token !== 'seller') throw new Error('invalid');
        return { uid: 'seller' };
      },
    }),
  },
}));
import {
  updateProduct,
  getProductById,
} from '../controllers/productController';
import { validateProductUpdate } from '../validators/productValidator';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';
const app = express();
app.use(express.json());
app.put(
  '/api/products/:id',
  authMiddleware,
  validateProductUpdate,
  updateProduct,
);
app.get('/api/products/:id', authMiddleware, getProductById);
beforeEach(() => {
  jest.clearAllMocks();
  process.env.LISTING_EDIT_ENABLED = 'true';
});
afterAll(() => {
  delete process.env.LISTING_EDIT_ENABLED;
});
test('returns committed version and preserves sparse request semantics', async () => {
  mockUpdate.mockResolvedValue({
    id: 'listing',
    editVersion: 5,
    price: 10,
    paymentReservationId: null,
    hasSales: false,
  });
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ name: ' New title ', expectedEditVersion: 4 });
  expect(result.status).toBe(200);
  expect(result.body.data).toEqual({
    id: 'listing',
    editVersion: 5,
    price: 10,
  });
  expect(mockUpdate).toHaveBeenCalledWith(
    'listing',
    { name: 'New title', expectedEditVersion: 4 },
    'seller',
  );
});
test('unauthenticated and forbidden requests never reach the service', async () => {
  expect(
    (
      await request(app)
        .put('/api/products/listing')
        .send({ name: 'Title', expectedEditVersion: 0 })
    ).status,
  ).toBe(401);
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ name: 'Title', expectedEditVersion: 0, charityId: 'forbidden' });
  expect(result.status).toBe(400);
  expect(result.body.code).toBe('LISTING_VALIDATION_FAILED');
  expect(mockUpdate).not.toHaveBeenCalled();
});
test.each([
  [403, 'LISTING_NOT_OWNER'],
  [409, 'LISTING_VERSION_CONFLICT'],
  [409, 'LISTING_HAS_SALES'],
  [503, 'LISTING_EDIT_DISABLED'],
])('returns machine-readable %s/%s', async (status, code) => {
  mockUpdate.mockRejectedValue(
    new ListingSafetyError(status as number, code as string, 'Blocked'),
  );
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ name: 'Title', expectedEditVersion: 0 });
  expect(result.status).toBe(status);
  expect(result.body.code).toBe(code);
});
test('canonical reads expose the committed version and omit internal state', async () => {
  mockGet.mockResolvedValue({
    id: 'listing',
    editVersion: 5,
    status: 'active',
    price: 10,
    editSafetyVerified: true,
    hasBeenEdited: true,
  });
  const result = await request(app)
    .get('/api/products/listing')
    .set('Authorization', 'Bearer seller');
  expect(result.body.data).toMatchObject({
    id: 'listing',
    editVersion: 5,
    status: 'active',
  });
  expect(result.body.data).not.toHaveProperty('editSafetyVerified');
});
