import request from 'supertest';
import app from '../../../app';
import { ProductRepository } from '../repositories/ProductRepository';
import { admin } from '../../../shared/config/firebaseConfig';

// Mock Firebase
jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: jest.fn(),
    }),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

jest.mock('../repositories/ProductRepository');

describe('Product Like/Unlike Feature', () => {
  let mockUserToken: string;
  let mockUser2Token: string;
  const mockUserId = 'user-123';
  const mockUser2Id = 'user-456';
  const mockProductId = 'product-abc';

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserToken = 'valid-user-token';
    mockUser2Token = 'valid-user-2-token';

    // Mock auth verification
    (admin.auth().verifyIdToken as jest.Mock).mockImplementation((token: string) => {
      if (token === mockUserToken) {
        return Promise.resolve({ uid: mockUserId });
      }
      if (token === mockUser2Token) {
        return Promise.resolve({ uid: mockUser2Id });
      }
      throw new Error('Invalid token');
    });
  });

  describe('POST /api/products/:id/like', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app)
        .post(`/api/products/${mockProductId}/like`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should successfully like a product', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 1,
        likedBy: [mockUserId],
      };

      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .post(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.likeCount).toBe(1);
      expect(response.body.data.isLikedByUser).toBe(true);
      expect(ProductRepository.prototype.addLike).toHaveBeenCalledWith(mockProductId, mockUserId);
    });

    it('should be idempotent - liking already-liked product succeeds', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 5,
        likedBy: [mockUserId, 'user-789'],
      };

      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .post(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 when product does not exist', async () => {
      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/products/nonexistent/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/products/:id/like', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app)
        .delete(`/api/products/${mockProductId}/like`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should successfully unlike a product', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 0,
        likedBy: [],
      };

      (ProductRepository.prototype.removeLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .delete(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.likeCount).toBe(0);
      expect(response.body.data.isLikedByUser).toBe(false);
      expect(ProductRepository.prototype.removeLike).toHaveBeenCalledWith(mockProductId, mockUserId);
    });

    it('should be idempotent - unliking non-liked product succeeds', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 3,
        likedBy: ['user-789', 'user-101'],
      };

      (ProductRepository.prototype.removeLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .delete(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 when product does not exist', async () => {
      (ProductRepository.prototype.removeLike as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .delete(`/api/products/nonexistent/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/products/:id - with like status', () => {
    it('should include isLikedByUser=true when user has liked product', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 10,
        likedBy: [mockUserId, 'user-789'],
      };

      (ProductRepository.prototype.getById as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .get(`/api/products/${mockProductId}`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.likeCount).toBe(10);
      expect(response.body.data.isLikedByUser).toBe(true);
    });

    it('should include isLikedByUser=false when user has not liked product', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 5,
        likedBy: ['user-789'],
      };

      (ProductRepository.prototype.getById as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .get(`/api/products/${mockProductId}`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.likeCount).toBe(5);
      expect(response.body.data.isLikedByUser).toBe(false);
    });

    it('should handle products without likedBy field (backwards compatibility)', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 3,
        // No likedBy field
      };

      (ProductRepository.prototype.getById as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .get(`/api/products/${mockProductId}`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.likeCount).toBe(3);
      expect(response.body.data.isLikedByUser).toBe(false);
    });
  });

  describe('GET /api/products/user/liked', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app)
        .get('/api/products/user/liked');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return all products liked by authenticated user', async () => {
      const mockLikedProducts = [
        {
          id: 'product-1',
          name: 'Product 1',
          likes: 10,
          likedBy: [mockUserId, 'user-789'],
        },
        {
          id: 'product-2',
          name: 'Product 2',
          likes: 5,
          likedBy: [mockUserId],
        },
      ];

      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue(mockLikedProducts);

      const response = await request(app)
        .get('/api/products/user/liked')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].isLikedByUser).toBe(true);
      expect(response.body.data[1].isLikedByUser).toBe(true);
      expect(ProductRepository.prototype.getProductsLikedByUser).toHaveBeenCalledWith(mockUserId);
    });

    it('should return empty array when user has not liked any products', async () => {
      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/products/user/liked')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('Multiple users liking same product', () => {
    it('should handle multiple users liking the same product independently', async () => {
      // User 1 likes product
      const mockProductUser1 = {
        id: mockProductId,
        likes: 1,
        likedBy: [mockUserId],
      };
      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(mockProductUser1);

      const response1 = await request(app)
        .post(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response1.status).toBe(200);
      expect(response1.body.data.likeCount).toBe(1);

      // User 2 likes same product
      const mockProductUser2 = {
        id: mockProductId,
        likes: 2,
        likedBy: [mockUserId, mockUser2Id],
      };
      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(mockProductUser2);

      const response2 = await request(app)
        .post(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUser2Token}`);

      expect(response2.status).toBe(200);
      expect(response2.body.data.likeCount).toBe(2);
    });
  });

  describe('Transaction-based idempotency', () => {
    it('should not double-increment counter when duplicate likes occur', async () => {
      // Simulate product already liked by user
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 5,
        likedBy: [mockUserId, 'user-789'],
      };

      // Transaction should detect user already in array and not increment
      (ProductRepository.prototype.addLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .post(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.likeCount).toBe(5); // Should not increase
      expect(response.body.data.isLikedByUser).toBe(true);
    });

    it('should not decrement below zero when removing like', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 0,
        likedBy: [],
      };

      (ProductRepository.prototype.removeLike as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .delete(`/api/products/${mockProductId}/like`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.likeCount).toBe(0); // Should stay at 0
    });
  });

  describe('Privacy - likedBy field not exposed', () => {
    it('should not include likedBy field in GET /api/products/:id response', async () => {
      const mockProduct = {
        id: mockProductId,
        name: 'Test Product',
        likes: 10,
        likedBy: [mockUserId, 'user-789', 'user-101'],
      };

      (ProductRepository.prototype.getById as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .get(`/api/products/${mockProductId}`)
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).not.toHaveProperty('likedBy');
      expect(response.body.data).toHaveProperty('likeCount');
      expect(response.body.data).toHaveProperty('isLikedByUser');
    });

    it('should not include likedBy field in GET /api/products response', async () => {
      const mockProducts = [
        {
          id: 'product-1',
          name: 'Product 1',
          likes: 5,
          likedBy: [mockUserId, 'user-789'],
        },
        {
          id: 'product-2',
          name: 'Product 2',
          likes: 3,
          likedBy: ['user-789'],
        },
      ];

      (ProductRepository.prototype.getAll as jest.Mock).mockResolvedValue(mockProducts);

      const response = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data[0]).not.toHaveProperty('likedBy');
      expect(response.body.data[1]).not.toHaveProperty('likedBy');
    });

    it('should not include likedBy field in GET /api/products/user/liked response', async () => {
      const mockLikedProducts = [
        {
          id: 'product-1',
          name: 'Product 1',
          likes: 10,
          likedBy: [mockUserId, 'user-789'],
        },
      ];

      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue(mockLikedProducts);

      const response = await request(app)
        .get('/api/products/user/liked')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data[0]).not.toHaveProperty('likedBy');
      expect(response.body.data[0]).toHaveProperty('likeCount');
      expect(response.body.data[0]).toHaveProperty('isLikedByUser');
    });
  });

  describe('Pagination on GET /api/products/user/liked', () => {
    it('should support limit query parameter', async () => {
      const mockProducts = [
        { id: 'product-1', name: 'Product 1', likes: 5, likedBy: [mockUserId] },
        { id: 'product-2', name: 'Product 2', likes: 3, likedBy: [mockUserId] },
      ];

      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue(mockProducts);

      const response = await request(app)
        .get('/api/products/user/liked?limit=10')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(ProductRepository.prototype.getProductsLikedByUser).toHaveBeenCalledWith(
        mockUserId,
        10,
        undefined
      );
    });

    it('should support startAfter query parameter for cursor pagination', async () => {
      const mockProducts = [
        { id: 'product-3', name: 'Product 3', likes: 2, likedBy: [mockUserId] },
      ];

      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue(mockProducts);

      const response = await request(app)
        .get('/api/products/user/liked?limit=5&startAfter=product-2')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(ProductRepository.prototype.getProductsLikedByUser).toHaveBeenCalledWith(
        mockUserId,
        5,
        'product-2'
      );
    });

    it('should use default limit of 20 when not specified', async () => {
      (ProductRepository.prototype.getProductsLikedByUser as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/products/user/liked')
        .set('Authorization', `Bearer ${mockUserToken}`);

      expect(response.status).toBe(200);
      expect(ProductRepository.prototype.getProductsLikedByUser).toHaveBeenCalledWith(
        mockUserId,
        20,
        undefined
      );
    });
  });
});
