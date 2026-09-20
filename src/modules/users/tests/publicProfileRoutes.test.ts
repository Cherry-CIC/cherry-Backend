import request from 'supertest';
import swaggerJsdoc from 'swagger-jsdoc';
import app from '../../../app';
import { admin } from '../../../shared/config/firebaseConfig';
import { swaggerOptions } from '../../../shared/config/swaggerConfig';
import { PublicProduct } from '../model/PublicProduct';
import { PublicProductRepository } from '../repositories/PublicProductRepository';
import { PublicUserRepository } from '../repositories/PublicUserRepository';
import { PublicProfileService } from '../services/PublicProfileService';
import { ServiceFactory } from '../services/ServiceFactory';

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
const product: PublicProduct = {
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
  visibility: 'public',
};
const profilePath = '/api/users/seller-uid/public-profile';
const verifyToken = admin.auth().verifyIdToken as jest.Mock;
const getUser = jest.spyOn(PublicUserRepository.prototype, 'getByFirebaseUid');
const getProducts = jest.spyOn(
  PublicProductRepository.prototype,
  'getPublicPage',
);
const getProfile = jest.spyOn(
  PublicProfileService.prototype,
  'getPublicProfile',
);
const errorLog = jest
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);
const originalCursorKey = process.env.PUBLIC_PROFILE_CURSOR_KEY;

const authenticated = (path = profilePath) =>
  request(app).get(path).set('Authorization', 'Bearer approved-test-token');

beforeEach(() => {
  process.env.PUBLIC_PROFILE_CURSOR_KEY = Buffer.alloc(32, 7).toString(
    'base64',
  );
  ServiceFactory.reset();
  verifyToken.mockReset().mockResolvedValue({ uid: 'viewer-uid' });
  getUser.mockReset().mockResolvedValue(user);
  getProducts
    .mockReset()
    .mockResolvedValue({ products: [product], nextPosition: null });
  getProfile.mockClear();
  errorLog.mockClear();
});

afterAll(() => {
  if (originalCursorKey === undefined) {
    delete process.env.PUBLIC_PROFILE_CURSOR_KEY;
  } else {
    process.env.PUBLIC_PROFILE_CURSOR_KEY = originalCursorKey;
  }
  ServiceFactory.reset();
  jest.restoreAllMocks();
});

describe('Mounted public profile route', () => {
  it('uses Firebase bearer authentication and the exact Flutter response envelope', async () => {
    const response = await authenticated();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyToken).toHaveBeenCalledWith('approved-test-token');
    expect(getUser).toHaveBeenCalledWith('seller-uid');
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 20, undefined);
    expect(response.body).toEqual({
      success: true,
      data: { user, products: [product] },
      meta: { limit: 20, nextCursor: null, hasMore: false },
    });
  });

  it.each([undefined, 'Basic token', 'Bearer'])(
    'rejects missing or malformed bearer authentication %s',
    async (header) => {
      const pending = request(app).get(profilePath);
      if (header) pending.set('Authorization', header);
      const response = await pending;
      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('data');
      expect(verifyToken).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('does not return raw Firebase token-verification failures', async () => {
    verifyToken.mockRejectedValue(
      new Error('private-token private@example.org providerData'),
    );
    const response = await authenticated();
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Invalid authentication token',
    });
    expect(response.text).not.toMatch(
      /private-token|private@example.org|providerData/,
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('rejects a decoded authentication record without a viewer UID', async () => {
    verifyToken.mockResolvedValue({});
    const response = await authenticated();
    expect(response.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([1, 50])('accepts page size %i as an integer', async (limit) => {
    const response = await authenticated().query({ limit });
    expect(response.status).toBe(200);
    expect(response.body.meta.limit).toBe(limit);
    expect(getProducts).toHaveBeenCalledWith('seller-uid', limit, undefined);
  });

  it.each(['0', '-1', '51', '1.5', 'invalid', '', 'Infinity'])(
    'rejects invalid page size %s',
    async (limit) => {
      const response = await authenticated().query({ limit });
      expect(response.status).toBe(400);
      expect(getUser).not.toHaveBeenCalled();
      expect(response.body).not.toHaveProperty('data');
    },
  );

  it('rejects repeated page-size query parameters', async () => {
    const response = await authenticated(`${profilePath}?limit=1&limit=50`);
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('trims the requested Firebase UID before resolving profiles or listings', async () => {
    const response = await authenticated(
      '/api/users/%20seller-uid%20/public-profile',
    );
    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe('seller-uid');
    expect(getUser).toHaveBeenCalledWith('seller-uid');
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 20, undefined);
  });

  it.each([
    '%20',
    // Padding keeps HTTP clients from normalising dot path segments first.
    '%20.%20',
    '%20..%20',
    'deleted_user',
    'seller%2Fprivate',
    'seller%5Cprivate',
    'seller%00uid',
    'seller%0A',
    'seller%7Fuid',
    'seller%C2%80uid',
    'x'.repeat(129),
  ])('rejects invalid seller identifier %s', async (encoded) => {
    const response = await authenticated(
      `/api/users/${encoded}/public-profile`,
    );
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty('data');
  });

  it('strips client filters so they cannot change the owner or public policy', async () => {
    const response = await authenticated().query({
      userId: 'private-owner',
      owner: 'private-owner',
      status: 'sold',
      visibility: 'private',
      moderationStatus: 'hidden',
      limit: 1,
    });
    expect(response.status).toBe(200);
    expect(getProfile).toHaveBeenCalledWith('seller-uid', 'viewer-uid', {
      limit: 1,
    });
    expect(getProducts).toHaveBeenCalledWith('seller-uid', 1, undefined);
  });

  it('returns the user on successful pages with no available listings', async () => {
    getProducts.mockResolvedValue({ products: [], nextPosition: null });
    const response = await authenticated();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { user, products: [] },
      meta: { limit: 20, nextCursor: null, hasMore: false },
    });
  });

  it('projects only the three public user fields even if the repository shape grows', async () => {
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
    const response = await authenticated();
    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual(user);
    const prohibited = Object.keys(record).filter((key) => !(key in user));
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        expect(prohibited).not.toContain(key);
        check(nested);
      }
    };
    check(response.body);
    expect(response.text).not.toContain('Private Full Name');
  });

  it('returns a generic unavailable response and never fetches products for unavailable accounts', async () => {
    getUser.mockResolvedValue(null);
    const response = await authenticated();
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'This profile is unavailable',
      timestamp: expect.any(String),
    });
    expect(getProducts).not.toHaveBeenCalled();
  });

  it.each(['profile', 'products'])(
    'returns retryable 503 with safe logging for %s database failures',
    async (operation) => {
      const failure = new Error('database secret-token private@example.org');
      if (operation === 'profile') getUser.mockRejectedValue(failure);
      else getProducts.mockRejectedValue(failure);
      const response = await authenticated();
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        success: false,
        message: 'Unable to load this profile. Please try again.',
        timestamp: expect.any(String),
      });
      expect(response.text).not.toMatch(
        /secret-token|private@example.org|database/,
      );
      expect(errorLog.mock.calls).toEqual([['public_profile.fetch_failed']]);
    },
  );

  it.each(['not-a-cursor', 'A'.repeat(40), 'A'.repeat(4097)])(
    'rejects malformed or tampered cursors',
    async (cursor) => {
      const response = await authenticated().query({ cursor });
      expect(response.status).toBe(400);
      expect(response.body).not.toHaveProperty('data');
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('paginates with the encrypted cursor and binds it to both seller and viewer', async () => {
    const position = { seconds: 100, nanoseconds: 123456789, id: 'listing-id' };
    getProducts.mockResolvedValueOnce({
      products: [product],
      nextPosition: position,
    });
    const first = await authenticated().query({ limit: 1 });
    expect(first.status).toBe(200);
    const cursor = first.body.meta.nextCursor;
    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);
    expect(first.body.meta.hasMore).toBe(true);
    const last = await authenticated().query({ limit: 1, cursor });
    expect(last.status).toBe(200);
    expect(getProducts).toHaveBeenLastCalledWith('seller-uid', 1, position);
    expect(last.body.meta).toEqual({
      limit: 1,
      nextCursor: null,
      hasMore: false,
    });
    const wrongSeller = await authenticated(
      '/api/users/other-seller/public-profile',
    ).query({ cursor });
    expect(wrongSeller.status).toBe(400);
    verifyToken.mockResolvedValue({ uid: 'other-viewer' });
    const wrongViewer = await authenticated().query({ cursor });
    expect(wrongViewer.status).toBe(400);
    expect(getProducts).toHaveBeenCalledTimes(2);
  });

  it('keeps missing cursor configuration as a retryable operational error', async () => {
    delete process.env.PUBLIC_PROFILE_CURSOR_KEY;
    const response = await authenticated();
    expect(response.status).toBe(503);
    expect(response.body).not.toHaveProperty('data');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('does not shadow the mounted public-profile route with a generic user route', async () => {
    const response = await authenticated();
    expect(response.status).toBe(200);
    expect(getProfile).toHaveBeenCalledTimes(1);
    const generic = await authenticated('/api/users/seller-uid');
    expect(generic.status).toBe(404);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });
});

describe('Public profile Swagger', () => {
  it('generates the mounted authenticated contract without private user fields', () => {
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
    const operation = spec.paths['/api/users/{userId}/public-profile'].get;
    expect(operation.tags).toContain('Users');
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(
      operation.parameters.map(({ name, in: location }) => [name, location]),
    ).toEqual([
      ['userId', 'path'],
      ['limit', 'query'],
      ['cursor', 'query'],
    ]);
    expect(
      operation.parameters.find(({ name }) => name === 'limit')?.schema,
    ).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: 20,
    });
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '429',
      '500',
      '503',
    ]);
    const publicUser = spec.components.schemas.PublicUser;
    expect(publicUser.additionalProperties).toBe(false);
    expect(Object.keys(publicUser.properties).sort()).toEqual([
      'id',
      'profileImageUrl',
      'username',
    ]);
    expect(publicUser.required.sort()).toEqual([
      'id',
      'profileImageUrl',
      'username',
    ]);
    expect(spec.components.schemas.PublicProfilePagination.required).toEqual([
      'limit',
      'nextCursor',
      'hasMore',
    ]);
    expect(spec.components.schemas.PublicProfileResponse.required).toEqual([
      'success',
      'data',
      'meta',
    ]);
  });
});
