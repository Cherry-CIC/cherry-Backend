import express from 'express';
import request from 'supertest';

// Only Firebase is doubled: requests exercise the real route, authentication
// middleware, controller, service and repository without contacting live data.
const mockDocuments = new Map<string, Record<string, unknown>>();
const mockTransaction = {
  get: jest.fn(async (path: string) => ({
    id: path.split('/').pop(),
    exists: mockDocuments.has(path),
    data: () => mockDocuments.get(path),
  })),
  set: jest.fn((path: string, data: Record<string, unknown>) => {
    mockDocuments.set(path, data);
  }),
  delete: jest.fn((path: string) => mockDocuments.delete(path)),
  update: jest.fn((path: string, data: Record<string, unknown>) => {
    mockDocuments.set(path, { ...mockDocuments.get(path), ...data });
  }),
};
const mockRunTransaction = jest.fn(async (operation) =>
  operation(mockTransaction),
);

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: (name: string) => ({ doc: (id: string) => `${name}/${id}` }),
    runTransaction: mockRunTransaction,
  },
  admin: {
    auth: () => ({
      verifyIdToken: async (token: string) => {
        if (token !== 'seller-token' && token !== 'viewer-token') {
          throw new Error('Invalid test token');
        }
        return { uid: token === 'seller-token' ? 'seller-1' : 'viewer-1' };
      },
    }),
  },
}));

import productRoutes from '../routes/productRoutes';

describe('POST /api/products/:id/like', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  const productPath = 'products/product-1';
  const endpoint = '/api/products/product-1/like';

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocuments.clear();
    mockDocuments.set(productPath, {
      userId: 'seller-1',
      name: 'Blue shirt',
      likes: 3,
    });
  });

  const expectNoWrites = () => {
    expect(mockTransaction.set).not.toHaveBeenCalled();
    expect(mockTransaction.delete).not.toHaveBeenCalled();
    expect(mockTransaction.update).not.toHaveBeenCalled();
  };

  it.each([false, true])(
    'rejects an owner liking their product (existing self-like: %s)',
    async (alreadyLiked) => {
      const likePath = 'user_likes/seller-1_product-1';
      if (alreadyLiked) mockDocuments.set(likePath, { userId: 'seller-1' });

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer seller-token')
        .send({ like: true, userId: 'viewer-1' });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        message: 'You cannot like your own product',
      });
      expect(response.body).not.toHaveProperty('data');
      expectNoWrites();
      expect(mockDocuments.get(productPath)?.likes).toBe(3);
      expect(mockDocuments.has(likePath)).toBe(alreadyLiked);
    },
  );

  it('keeps other users liking and unliking idempotent', async () => {
    for (const like of [true, true, false, false]) {
      const response = await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer viewer-token')
        .send({ like });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: 'product-1',
        userId: 'seller-1',
        liked: like,
        likes: like ? 4 : 3,
      });
      expect(mockDocuments.has('user_likes/viewer-1_product-1')).toBe(like);
    }
    expect(mockTransaction.set).toHaveBeenCalledTimes(1);
    expect(mockTransaction.delete).toHaveBeenCalledTimes(1);
    expect(mockTransaction.update).toHaveBeenCalledTimes(2);
  });

  it.each([0, 3])(
    'allows removing a historical self-like with %i recorded likes',
    async (likes) => {
      mockDocuments.set(productPath, { userId: 'seller-1', likes });
      mockDocuments.set('user_likes/seller-1_product-1', {
        userId: 'seller-1',
      });

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer seller-token')
        .send({ like: false });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        liked: false,
        likes: Math.max(0, likes - 1),
      });
      expect(mockDocuments.has('user_likes/seller-1_product-1')).toBe(false);
      expect(mockTransaction.set).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'Bearer invalid-token'])(
    'requires valid authentication (%s)',
    async (authorization) => {
      const pending = request(app).post(endpoint);
      if (authorization) pending.set('Authorization', authorization);
      const response = await pending.send({ like: true });

      expect(response.status).toBe(401);
      expect(mockRunTransaction).not.toHaveBeenCalled();
    },
  );

  it('keeps invalid like flags as bad requests', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer viewer-token')
      .send({ like: 'true' });

    expect(response.status).toBe(400);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('keeps missing products as not found', async () => {
    mockDocuments.delete(productPath);
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer viewer-token')
      .send({ like: true });

    expect(response.status).toBe(404);
    expectNoWrites();
  });
});
