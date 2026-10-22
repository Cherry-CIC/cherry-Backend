import express from 'express';
import request from 'supertest';
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: () => ({
      updateProduct: mockUpdate,
      getProductById: mockGet,
      getVisibleProductById: mockGet,
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
});
test('updates an allowed field and preserves sparse request semantics', async () => {
  mockUpdate.mockResolvedValue({
    id: 'listing',
    price: 10,
    hasSales: false,
  });
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ expectedEditVersion: 0, name: ' New title ' });
  expect(result.status).toBe(200);
  expect(result.body.data).toEqual({
    id: 'listing',
    price: 10,
    editVersion: 0,
  });
  expect(mockUpdate).toHaveBeenCalledWith(
    'listing',
    { expectedEditVersion: 0, name: 'New title' },
    'seller',
  );
});
test('unauthenticated and forbidden requests never reach the service', async () => {
  expect(
    (
      await request(app)
        .put('/api/products/listing')
        .send({ expectedEditVersion: 0, name: 'Title' })
    ).status,
  ).toBe(401);
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ expectedEditVersion: 0, name: 'Title', charityId: 'forbidden' });
  expect(result.status).toBe(400);
  expect(result.body.code).toBe('LISTING_VALIDATION_FAILED');
  expect(mockUpdate).not.toHaveBeenCalled();
});
test.each([
  [403, 'LISTING_NOT_OWNER'],
  [409, 'LISTING_HAS_SALES'],
])('returns machine-readable %s/%s', async (status, code) => {
  mockUpdate.mockRejectedValue(
    new ListingSafetyError(status as number, code as string, 'Blocked'),
  );
  const result = await request(app)
    .put('/api/products/listing')
    .set('Authorization', 'Bearer seller')
    .send({ expectedEditVersion: 0, name: 'Title' });
  expect(result.status).toBe(status);
  expect(result.body.code).toBe(code);
});
test('canonical reads omit internal listing state', async () => {
  mockGet.mockResolvedValue({
    id: 'listing',
    status: 'active',
    price: 10,
    hasSales: false,
    hasBeenEdited: true,
  });
  const result = await request(app)
    .get('/api/products/listing')
    .set('Authorization', 'Bearer seller');
  expect(result.body.data).toMatchObject({
    id: 'listing',
    status: 'active',
  });
  expect(result.body.data).not.toHaveProperty('hasSales');
  expect(result.body.data).not.toHaveProperty('hasBeenEdited');
});
