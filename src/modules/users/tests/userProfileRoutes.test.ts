import request from 'supertest';
import swaggerJsdoc from 'swagger-jsdoc';
import app from '../../../app';
import { admin } from '../../../shared/config/firebaseConfig';
import { swaggerOptions } from '../../../shared/config/swaggerConfig';
import { UserProduct } from '../model/UserProfile';
import { UserProductRepository } from '../repositories/UserProductRepository';
import { UserProfileRepository } from '../repositories/UserProfileRepository';

jest.mock('../../../shared/config/firebaseConfig', () => {
  const auth = { verifyIdToken: jest.fn() };
  return { firestore: {}, admin: { auth: () => auth } };
});
jest.mock('../../products/routes/productRoutes', () =>
  require('express').Router(),
);
jest.mock('../../categories/routes/categoryRoutes', () =>
  require('express').Router(),
);
jest.mock('../../charities/routes/charityRoutes', () =>
  require('express').Router(),
);
jest.mock('../../auth/routes/authRoutes', () => require('express').Router());
jest.mock('../../payment/routes/paymentRoutes', () =>
  require('express').Router(),
);
jest.mock('../../order/routes/orderRoutes', () => require('express').Router());
jest.mock('../../order/routes/adminRoutes', () => require('express').Router());
jest.mock('../../shipping/routes/shippingRoutes', () =>
  require('express').Router(),
);
jest.mock('../../postage-sizes/routes/postageSizeRoutes', () =>
  require('express').Router(),
);
jest.mock('../../notifications/routes/notificationRoutes', () =>
  require('express').Router(),
);
jest.mock('../../payment/controllers/paymentController', () => ({
  stripeWebhook: jest.fn(),
}));

const user = {
  id: 'seller-uid',
  username: 'Alex',
  profileImageUrl: null,
};
const product: UserProduct = {
  id: 'listing-id',
  userId: 'seller-uid',
  name: 'Blue cotton shirt',
  description: 'A pre-loved cotton shirt in good condition.',
  quality: 'Good',
  product_images: ['https://example.org/listing.jpg'],
  donation: 10,
  price: 10,
  securityFee: 1,
  likes: 0,
  number: 1,
  size: 'M',
  postageSize: 'small-parcel-id',
  categoryId: 'shirts-id',
  charityId: 'charity-id',
  status: 'active',
};

const profilePath = '/api/users/seller-uid/profile';
const productsPath = '/api/users/seller-uid/products';
const verifyToken = admin.auth().verifyIdToken as jest.Mock;
const getUser = jest.spyOn(UserProfileRepository.prototype, 'getByFirebaseUid');
const getProducts = jest.spyOn(UserProductRepository.prototype, 'getPage');
const errorLog = jest
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);
const originalCursorKey = process.env.USER_PRODUCTS_CURSOR_KEY;

const authenticated = (path: string) =>
  request(app).get(path).set('Authorization', 'Bearer approved-test-token');

beforeEach(() => {
  process.env.USER_PRODUCTS_CURSOR_KEY = Buffer.alloc(32, 7).toString(
    'base64',
  );
  verifyToken.mockReset().mockResolvedValue({ uid: 'viewer-uid' });
  getUser.mockReset().mockResolvedValue(user);
  getProducts
    .mockReset()
    .mockResolvedValue({ products: [product], nextPosition: null });
  errorLog.mockClear();
});

afterAll(() => {
  if (originalCursorKey === undefined) {
    delete process.env.USER_PRODUCTS_CURSOR_KEY;
  } else {
    process.env.USER_PRODUCTS_CURSOR_KEY = originalCursorKey;
  }
  jest.restoreAllMocks();
});

describe('Mounted user profile routes', () => {
  it('returns the safe profile without products', async () => {
    const response = await authenticated(profilePath);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyToken).toHaveBeenCalledWith('approved-test-token');
    expect(getUser).toHaveBeenCalledWith('seller-uid');
    expect(getProducts).not.toHaveBeenCalled();
    expect(response.body).toEqual({ success: true, data: user });
  });

  it('returns a paginated products page without repeating the profile', async () => {
    const response = await authenticated(productsPath);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(getUser).toHaveBeenCalledWith('seller-uid');
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 20, undefined);
    expect(response.body).toEqual({
      success: true,
      data: { products: [product] },
      meta: { limit: 20, nextCursor: null, hasMore: false },
    });
    expect(response.body.data).not.toHaveProperty('user');
  });

  it.each([profilePath, productsPath])(
    'rejects missing or malformed bearer authentication for %s',
    async (path) => {
      for (const header of [undefined, 'Basic token', 'Bearer']) {
        const pending = request(app).get(path);
        if (header) pending.set('Authorization', header);
        const response = await pending;
        expect(response.status).toBe(401);
      }
      expect(verifyToken).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('does not return raw Firebase token-verification failures', async () => {
    verifyToken.mockRejectedValue(
      new Error('private-token private@example.org providerData'),
    );
    const response = await authenticated(profilePath);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Invalid authentication token',
    });
    expect(response.text).not.toMatch(
      /private-token|private@example.org|providerData/,
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('rejects a decoded authentication record without a viewer UID', async () => {
    verifyToken.mockResolvedValue({});
    const response = await authenticated(profilePath);
    expect(response.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([1, 50])('accepts products page size %i as an integer', async (limit) => {
    const response = await authenticated(productsPath).query({ limit });
    expect(response.status).toBe(200);
    expect(response.body.meta.limit).toBe(limit);
    expect(getProducts).toHaveBeenCalledWith('seller-uid', limit, undefined);
  });

  it.each(['0', '-1', '51', '1.5', 'invalid', '', 'Infinity'])(
    'rejects invalid products page size %s',
    async (limit) => {
      const response = await authenticated(productsPath).query({ limit });
      expect(response.status).toBe(400);
      expect(getUser).not.toHaveBeenCalled();
      expect(response.body).not.toHaveProperty('data');
    },
  );

  it('rejects repeated products page-size query parameters', async () => {
    const response = await authenticated(`${productsPath}?limit=1&limit=50`);
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('strips client filters so they cannot change the owner or product policy', async () => {
    const response = await authenticated(productsPath).query({
      userId: 'private-owner',
      owner: 'private-owner',
      status: 'sold',
      visibility: 'private',
      moderationStatus: 'hidden',
      limit: 1,
    });
    expect(response.status).toBe(200);
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 1, undefined);
  });

  it('trims the requested Firebase UID before resolving profile and products', async () => {
    const profile = await authenticated('/api/users/%20seller-uid%20/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.data.id).toBe('seller-uid');
    const products = await authenticated('/api/users/%20seller-uid%20/products');
    expect(products.status).toBe(200);
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 20, undefined);
  });

  it.each([
    '%20',
    '%20.%20',
    '%20..%20',
    'deleted_user',
    'seller%2Fprivate',
    'seller%5Cprivate',
    'seller%00uid',
    'seller%0A',
    'seller%7Fuid',
    'seller%C2%80uid',
  ])('rejects invalid user identifier %s', async (encoded) => {
    const response = await authenticated(`/api/users/${encoded}/profile`);
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('projects only the three safe user fields even if the repository shape grows', async () => {
    const record = {
      ...user,
      email: 'private@example.org',
      phone: 'private',
      phoneNumber: 'private',
      address: { postcode: 'private' },
      firebaseUid: 'internal-uid',
      tokens: { idToken: 'private' },
      authentication: {},
      providerData: [],
      orders: [],
      shipments: [],
      payment: {},
      displayName: 'Private Full Name',
    };
    getUser.mockResolvedValue(record);
    const response = await authenticated(profilePath);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(user);
    expect(response.text).not.toContain('Private Full Name');
    expect(response.text).not.toContain('private@example.org');
  });

  it('returns a generic unavailable response and never fetches products for unavailable accounts', async () => {
    getUser.mockResolvedValue(null);
    const response = await authenticated(productsPath);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'This profile is unavailable',
      timestamp: expect.any(String),
    });
    expect(getProducts).not.toHaveBeenCalled();
  });

  it.each([
    ['profile', profilePath, 'user_profile.fetch_failed', 'Unable to load this profile. Please try again.'],
    ['products', productsPath, 'user_products.fetch_failed', 'Unable to load these products. Please try again.'],
  ])(
    'returns retryable 503 with safe logging for %s database failures',
    async (operation, path, logMessage, responseMessage) => {
      const failure = new Error('database secret-token private@example.org');
      if (operation === 'profile') getUser.mockRejectedValue(failure);
      else getProducts.mockRejectedValue(failure);
      const response = await authenticated(path);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        success: false,
        message: responseMessage,
        timestamp: expect.any(String),
      });
      expect(response.text).not.toMatch(
        /secret-token|private@example.org|database/,
      );
      expect(errorLog.mock.calls).toEqual([[logMessage]]);
    },
  );

  it.each(['not-a-cursor', 'A'.repeat(40), 'A'.repeat(4097)])(
    'rejects malformed or tampered products cursors',
    async (cursor) => {
      const response = await authenticated(productsPath).query({ cursor });
      expect(response.status).toBe(400);
      expect(response.body).not.toHaveProperty('data');
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('paginates products with an encrypted cursor bound to user and viewer', async () => {
    const position = { seconds: 100, nanoseconds: 123456789, id: 'listing-id' };
    getProducts.mockResolvedValueOnce({
      products: [product],
      nextPosition: position,
    });
    const first = await authenticated(productsPath).query({ limit: 1 });
    expect(first.status).toBe(200);
    const cursor = first.body.meta.nextCursor;
    expect(typeof cursor).toBe('string');
    const last = await authenticated(productsPath).query({ limit: 1, cursor });
    expect(last.status).toBe(200);
    expect(getProducts).toHaveBeenLastCalledWith('seller-uid', 1, position);
    const wrongUser = await authenticated('/api/users/other-seller/products').query({
      cursor,
    });
    expect(wrongUser.status).toBe(400);
    verifyToken.mockResolvedValue({ uid: 'other-viewer' });
    const wrongViewer = await authenticated(productsPath).query({ cursor });
    expect(wrongViewer.status).toBe(400);
    expect(getProducts).toHaveBeenCalledTimes(2);
  });

  it('keeps missing cursor configuration as a retryable products error', async () => {
    delete process.env.USER_PRODUCTS_CURSOR_KEY;
    const response = await authenticated(productsPath);
    expect(response.status).toBe(503);
    expect(response.body).not.toHaveProperty('data');
    expect(getUser).not.toHaveBeenCalled();
  });

});

describe('User profile Swagger', () => {
  it('generates separate profile and products contracts without private user fields', () => {
    const spec = swaggerJsdoc({ ...swaggerOptions, failOnErrors: true }) as {
      paths: Record<
        string,
        {
          get: {
            tags: string[];
            security: object[];
            parameters: { name: string; in: string; schema: object }[];
            responses: Record<string, unknown>;
          };
        }
      >;
      components: {
        securitySchemes: { bearerAuth: object };
        schemas: Record<
          string,
          {
            properties: Record<string, unknown>;
            required: string[];
            additionalProperties?: boolean;
          }
        >;
      };
    };
    const profile = spec.paths['/api/users/{userId}/profile'].get;
    const products = spec.paths['/api/users/{userId}/products'].get;
    expect(profile.tags).toContain('Users');
    expect(products.tags).toContain('Users');
    expect(profile.security).toEqual([{ bearerAuth: [] }]);
    expect(products.security).toEqual([{ bearerAuth: [] }]);
    expect(profile.parameters.map(({ name, in: location }) => [name, location])).toEqual([
      ['userId', 'path'],
    ]);
    expect(products.parameters.map(({ name, in: location }) => [name, location])).toEqual([
      ['userId', 'path'],
      ['limit', 'query'],
      ['cursor', 'query'],
    ]);
    expect(Object.keys(profile.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '503',
    ]);
    const profileSchema = spec.components.schemas.UserProfile;
    expect(profileSchema.additionalProperties).toBe(false);
    expect(Object.keys(profileSchema.properties).sort()).toEqual([
      'id',
      'profileImageUrl',
      'username',
    ]);
    expect(profileSchema.required.sort()).toEqual([
      'id',
      'profileImageUrl',
      'username',
    ]);
    expect(spec.components.schemas.UserProduct.required).not.toContain(
      'visibility',
    );
    expect(spec.components.schemas.UserProductsPagination.required).toEqual([
      'limit',
      'nextCursor',
      'hasMore',
    ]);
    expect(spec.components.schemas.UserProfileResponse.required).toEqual([
      'success',
      'data',
    ]);
    expect(spec.components.schemas.UserProductsResponse.required).toEqual([
      'success',
      'data',
      'meta',
    ]);
  });
});
