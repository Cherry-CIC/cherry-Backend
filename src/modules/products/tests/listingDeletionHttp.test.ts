import express from 'express';
import request from 'supertest';
const mockDelete = jest.fn();
jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getProductService: () => ({ deleteProduct: mockDelete }) },
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
import { deleteProduct } from '../controllers/productController';
import { authMiddleware } from '../../../shared/middleware/authMiddleWare';
import { validateProductId } from '../validators/productIdValidator';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';
const app = express();
app.delete(
  '/api/products/:id',
  authMiddleware,
  validateProductId,
  deleteProduct,
);
beforeEach(() => jest.clearAllMocks());

test('unauthenticated and invalid requests never reach deletion', async () => {
  expect((await request(app).delete('/api/products/listing')).status).toBe(401);
  expect(
    (
      await request(app)
        .delete('/api/products/x')
        .set('Authorization', 'Bearer seller')
    ).status,
  ).toBe(400);
  expect(mockDelete).not.toHaveBeenCalled();
});
test('success preserves the response envelope', async () => {
  mockDelete.mockResolvedValue(true);
  const response = await request(app)
    .delete('/api/products/listing')
    .set('Authorization', 'Bearer seller');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    data: null,
    message: 'Product deleted successfully',
  });
  expect(mockDelete).toHaveBeenCalledWith('listing', 'seller');
});
test.each([
  [403, 'LISTING_NOT_OWNER'],
  [404, 'LISTING_NOT_FOUND'],
  [409, 'LISTING_PAYMENT_PENDING'],
  [409, 'LISTING_HAS_SALES'],
  [409, 'LISTING_REVIEW_REQUIRED'],
])('preserves the %s/%s error contract', async (status, code) => {
  mockDelete.mockRejectedValue(
    new ListingSafetyError(status as number, code as string, 'Blocked'),
  );
  const response = await request(app)
    .delete('/api/products/listing')
    .set('Authorization', 'Bearer seller');
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({
    success: false,
    code,
    message: 'Blocked',
  });
});
