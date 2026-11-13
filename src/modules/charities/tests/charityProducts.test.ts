const mockGetCharityProducts = jest.fn();

jest.mock('../repositories/CharityRepository', () => ({
  CharityRepository: jest.fn().mockImplementation(() => ({
    getAll: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('../../products/repositories/ProductRepository', () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../categories/repositories/CategoryRepository', () => ({
  CategoryRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../postage-sizes/repositories/PostageSizeRepository', () => ({
  PostageSizeRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../blocks/repositories/CharityBlockRepository', () => ({
  CharityBlockRepository: jest.fn().mockImplementation(() => ({})),
}));

import { getCharityProducts } from '../controllers/charityController';
import {
  CharityProfileService,
  InvalidCharityProductCursor,
} from '../services/CharityProfileService';

describe('CharityProfileService', () => {
  const charity = {
    id: 'dogs-trust',
    name: 'Dogs Trust',
    image_url: 'https://example.com/dogs.png',
    description: 'Dogs Trust UK',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  it('returns only active non-hidden listings for the requested charity in newest-first order', async () => {
    const products = [
      {
        id: 'p-old',
        name: 'Shirt Old',
        price: 5,
        charityId: 'dogs-trust',
        categoryId: 'cat-1',
        postageSize: 'post-1',
        status: 'active',
        number: 1,
        userId: 'seller-1',
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
      {
        id: 'p-new',
        name: 'Jacket New',
        price: 10,
        charityId: 'dogs-trust',
        categoryId: 'cat-1',
        status: 'active',
        number: 1,
        userId: 'seller-2',
        createdAt: new Date('2026-01-02T10:00:00Z'),
      },
      {
        id: 'p-other-charity',
        name: 'Other Charity Tee',
        price: 8,
        charityId: 'mind',
        status: 'active',
        number: 1,
        userId: 'seller-3',
        createdAt: new Date('2026-01-03T10:00:00Z'),
      },
      {
        id: 'p-sold',
        name: 'Sold Item',
        price: 8,
        charityId: 'dogs-trust',
        status: 'sold',
        number: 1,
        userId: 'seller-4',
        createdAt: new Date('2026-01-03T10:00:00Z'),
      },
      {
        id: 'p-hidden',
        name: 'Hidden Item',
        price: 8,
        charityId: 'dogs-trust',
        status: 'active',
        hidden: true,
        number: 1,
        userId: 'seller-5',
        createdAt: new Date('2026-01-03T10:00:00Z'),
      },
      {
        id: 'p-zero-qty',
        name: 'Out Of Stock',
        price: 8,
        charityId: 'dogs-trust',
        status: 'active',
        number: 0,
        userId: 'seller-6',
        createdAt: new Date('2026-01-03T10:00:00Z'),
      },
    ];

    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      { getProductsByCharity: jest.fn().mockResolvedValue(products) },
      { getById: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Tops' }) },
      { getById: jest.fn().mockResolvedValue({ id: 'post-1', name: 'Small' }) },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    const page1 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 1,
    });

    expect(page1).not.toBeNull();
    expect(page1!.data.products.map((p) => p.id)).toEqual(['p-new']);
    expect(page1!.data.products[0].charity).toEqual(charity);
    expect(page1!.data.products[0].category).toEqual({
      id: 'cat-1',
      name: 'Tops',
    });
    expect(page1!.meta.hasMore).toBe(true);
    expect(page1!.meta.nextCursor).toBeTruthy();

    const page2 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 1,
      cursor: page1!.meta.nextCursor!,
    });

    expect(page2!.data.products.map((p) => p.id)).toEqual(['p-old']);
    expect(page2!.data.products[0].postageSizeDetails).toEqual({
      id: 'post-1',
      name: 'Small',
    });
    expect(page2!.meta.hasMore).toBe(false);
    expect(page2!.meta.nextCursor).toBeNull();
  });

  it('returns empty listings without querying products when viewer blocked the charity', async () => {
    const getProductsByCharity = jest.fn();
    const service = new CharityProfileService(
      { getById: jest.fn() },
      { getProductsByCharity },
      { getById: jest.fn() },
      { getById: jest.fn() },
      { isBlocked: jest.fn().mockResolvedValue(true) },
    );

    const result = await service.getCharityProducts('dogs-trust', 'viewer-1');

    expect(result).toEqual({
      data: { products: [] },
      meta: { limit: 20, nextCursor: null, hasMore: false },
    });
    expect(getProductsByCharity).not.toHaveBeenCalled();
  });

  it('returns null when the charity does not exist', async () => {
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(null) },
      { getProductsByCharity: jest.fn() },
      { getById: jest.fn() },
      { getById: jest.fn() },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    await expect(
      service.getCharityProducts('missing', 'viewer-1'),
    ).resolves.toBeNull();
  });

  it('rejects tampered cursors scoped to a different viewer or charity', async () => {
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      {
        getProductsByCharity: jest.fn().mockResolvedValue([
          {
            id: 'p-1',
            price: 3,
            charityId: 'dogs-trust',
            status: 'active',
            number: 1,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            id: 'p-2',
            price: 4,
            charityId: 'dogs-trust',
            status: 'active',
            number: 1,
            createdAt: new Date('2026-01-02T00:00:00Z'),
          },
        ]),
      },
      { getById: jest.fn().mockResolvedValue(null) },
      { getById: jest.fn().mockResolvedValue(null) },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    const page1 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 1,
    });

    await expect(
      service.getCharityProducts('dogs-trust', 'other-viewer', {
        cursor: page1!.meta.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(InvalidCharityProductCursor);

    await expect(
      service.getCharityProducts('other-charity', 'viewer-1', {
        cursor: page1!.meta.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(InvalidCharityProductCursor);
  });
});

describe('getCharityProducts controller', () => {
  const response = () => {
    const res: any = {};
    res.setHeader = jest.fn();
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    mockGetCharityProducts.mockReset();
  });

  it('requires authentication and sets private no-store cache headers', async () => {
    const res = response();

    await getCharityProducts(
      { params: { id: 'dogs-trust' }, query: {} } as any,
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('validates limit bounds and forwards valid requests to CharityProfileService', async () => {
    const invalidRes = response();
    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: { limit: '100' },
      } as any,
      invalidRes,
    );
    expect(invalidRes.status).toHaveBeenCalledWith(400);

    const spy = jest
      .spyOn(CharityProfileService.prototype, 'getCharityProducts')
      .mockResolvedValue({
        data: { products: [] },
        meta: { limit: 10, nextCursor: null, hasMore: false },
      });

    const validRes = response();
    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: { limit: '10' },
      } as any,
      validRes,
    );

    expect(validRes.status).toHaveBeenCalledWith(200);
    expect(spy).toHaveBeenCalledWith('dogs-trust', 'viewer-1', {
      limit: 10,
      cursor: undefined,
    });
    spy.mockRestore();
  });

  it('returns 404 when CharityProfileService returns null', async () => {
    const spy = jest
      .spyOn(CharityProfileService.prototype, 'getCharityProducts')
      .mockResolvedValue(null);
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'missing-charity' },
        query: {},
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    spy.mockRestore();
  });

  it('returns 400 when CharityProfileService throws InvalidCharityProductCursor', async () => {
    const spy = jest
      .spyOn(CharityProfileService.prototype, 'getCharityProducts')
      .mockRejectedValue(new InvalidCharityProductCursor());
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: { cursor: 'bad-cursor' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    spy.mockRestore();
  });
});
