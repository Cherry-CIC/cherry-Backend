import request from 'supertest';
import app from '../../../app';
import { OrderRepository } from '../repositories/OrderRepository';
import { admin } from '../../../shared/config/firebaseConfig';

// Mock Firebase Admin
jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: jest.fn(),
    }),
    storage: jest.fn().mockReturnValue({
      bucket: jest.fn().mockReturnValue({
        file: jest.fn().mockReturnValue({
          createWriteStream: jest.fn(),
          getSignedUrl: jest.fn(),
        }),
      }),
    }),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

jest.mock('../repositories/OrderRepository');

describe('CSV Export Orders - /api/admin/export/orders', () => {
  let mockToken: string;
  let mockAdminToken: string;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock tokens
    mockToken = 'valid-user-token';
    mockAdminToken = 'valid-admin-token';

    // Mock auth verification for regular user
    (admin.auth().verifyIdToken as jest.Mock).mockImplementation((token: string) => {
      if (token === mockAdminToken) {
        return Promise.resolve({ uid: 'admin-uid', admin: true });
      }
      if (token === mockToken) {
        return Promise.resolve({ uid: 'user-uid', admin: false });
      }
      throw new Error('Invalid token');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 403 when user is not an admin', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockToken}`)
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Admin access required');
    });
  });

  describe('Input Validation', () => {
    it('should return 400 when start_date is missing', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ end_date: '2024-12-31' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 when end_date is missing', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-01-01' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Missing required parameters');
    });

    it('should return 400 when date format is invalid', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024/01/01', end_date: '2024-12-31' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid date format');
    });

    it('should return 400 when start_date is after end_date', async () => {
      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-12-31', end_date: '2024-01-01' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid date range');
    });
  });

  describe('CSV Export Functionality', () => {
    beforeEach(() => {
      // Set up environment variable for storage bucket
      process.env.FIREBASE_STORAGE_BUCKET = 'test-bucket.appspot.com';

      // Mock storage write stream
      const mockWriteStream: any = {
        on: jest.fn((event: string, callback: () => void) => {
          if (event === 'finish') {
            setTimeout(callback, 0);
          }
          return mockWriteStream;
        }),
        write: jest.fn(),
        end: jest.fn(),
      };

      const mockFile = {
        createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
        getSignedUrl: jest.fn().mockResolvedValue(['https://storage.googleapis.com/signed-url']),
      };

      const mockBucket = {
        file: jest.fn().mockReturnValue(mockFile),
      };

      (admin.storage as jest.Mock).mockReturnValue({
        bucket: jest.fn().mockReturnValue(mockBucket),
      });
    });

    it('should return CSV with headers only when no orders exist', async () => {
      // Mock empty orders
      (OrderRepository.prototype.getOrdersByDateRange as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recordCount).toBe(0);
      expect(response.body.data.url).toBeDefined();
    });

    it('should successfully export orders within date range', async () => {
      // Mock orders data
      const mockOrders = [
        {
          id: 'order-1',
          userId: 'user-1',
          email: 'user1@example.com',
          amount: 5000, // £50.00
          productName: 'Winter Coat',
          status: 'completed',
          createdAt: new Date('2024-06-15'),
        },
        {
          id: 'order-2',
          userId: 'user-2',
          email: 'user2@example.com',
          amount: 2500, // £25.00
          productName: 'School Supplies',
          status: 'pending',
          createdAt: new Date('2024-07-20'),
        },
      ];

      (OrderRepository.prototype.getOrdersByDateRange as jest.Mock).mockResolvedValue(mockOrders);

      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recordCount).toBe(2);
      expect(response.body.data.url).toContain('https://');
      expect(response.body.data.filename).toContain('orders_2024-01-01_to_2024-12-31');
      expect(response.body.data.expiresIn).toBe('1 hour');
    });

    it('should handle orders with failed status', async () => {
      const mockOrders = [
        {
          id: 'order-failed',
          userId: 'user-3',
          email: 'user3@example.com',
          amount: 1000,
          productName: 'Donation',
          status: 'failed',
          createdAt: new Date('2024-08-01'),
        },
      ];

      (OrderRepository.prototype.getOrdersByDateRange as jest.Mock).mockResolvedValue(mockOrders);

      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-08-01', end_date: '2024-08-31' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recordCount).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when storage bucket is not configured', async () => {
      delete process.env.FIREBASE_STORAGE_BUCKET;

      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Storage not configured');
    });

    it('should return 500 when database query fails', async () => {
      process.env.FIREBASE_STORAGE_BUCKET = 'test-bucket.appspot.com';
      
      (OrderRepository.prototype.getOrdersByDateRange as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/admin/export/orders')
        .set('Authorization', `Bearer ${mockAdminToken}`)
        .query({ start_date: '2024-01-01', end_date: '2024-12-31' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
