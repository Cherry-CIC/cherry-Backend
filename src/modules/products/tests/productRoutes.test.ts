import request from 'supertest';

jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'user-1' }),
    }),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

jest.mock('../../../shared/middleware/authMiddleWare', () => ({
  authMiddleware: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { uid: 'user-1' };
    next();
  },
}));

jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: jest.fn(),
  },
}));

import app from '../../../app';
import { ServiceFactory } from '../services/ServiceFactory';

describe('Product API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ServiceFactory.getProductService as jest.Mock).mockReturnValue({
      getAllProducts: jest.fn().mockResolvedValue([
        { id: 'product-1', name: 'Coat' },
      ]),
    });
  });

  it('returns all products from the service layer', async () => {
    const response = await request(app)
      .get('/api/products')
      .set('Authorization', 'Bearer test-token');

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([{ id: 'product-1', name: 'Coat' }]);
  });
});
