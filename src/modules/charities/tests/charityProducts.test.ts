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

import { Timestamp } from 'firebase-admin/firestore';
import {
  CharityProductBatch,
  CharityProductPosition,
} from '../../products/repositories/ProductRepository';
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

  interface StoredProduct {
    id: string;
    name: string;
    price: number;
    charityId: string;
    categoryId?: string;
    postageSize?: string;
    status: 'active' | 'sold' | 'unlisted';
    number: number;
    userId: string;
    hidden?: boolean;
    moderationStatus?: 'approved' | 'hidden';
    createdAt: Timestamp;
  }

  const createBatchRepository = (getRecords: () => StoredProduct[]) => {
    const compare = (left: StoredProduct, right: StoredProduct): number =>
      right.createdAt.seconds - left.createdAt.seconds ||
      right.createdAt.nanoseconds - left.createdAt.nanoseconds ||
      (left.id === right.id ? 0 : left.id > right.id ? -1 : 1);

    const getCharityProductBatch = jest.fn(
      async (
        charityId: string,
        limit: number,
        after?:
          CharityProductPosition | FirebaseFirestore.QueryDocumentSnapshot,
      ): Promise<CharityProductBatch> => {
        const sorted = getRecords()
          .filter((item) => item.charityId === charityId)
          .sort(compare);

        let startAfterCursor: CharityProductPosition | null = null;
        if (after) {
          if ('seconds' in after && 'nanoseconds' in after) {
            startAfterCursor = after;
          } else {
            const ts = after.data().createdAt as Timestamp;
            startAfterCursor = {
              seconds: ts.seconds,
              nanoseconds: ts.nanoseconds,
              id: after.id,
            };
          }
        }

        const remaining = startAfterCursor
          ? sorted.filter(
              (item) =>
                compare(item, {
                  ...item,
                  id: startAfterCursor!.id,
                  createdAt: new Timestamp(
                    startAfterCursor!.seconds,
                    startAfterCursor!.nanoseconds,
                  ),
                }) > 0,
            )
          : sorted;

        const slice = remaining.slice(0, limit);
        const last = slice[slice.length - 1];

        return {
          items: slice.map((item) => ({
            product: {
              ...item,
              description: '',
              quality: 'Good',
              size: 'M',
              product_images: ['https://example.com/item.jpg'],
              donation: 10,
              likes: 0,
              categoryId: item.categoryId || 'cat-1',
              createdAt: item.createdAt.toDate(),
            },
            position: {
              seconds: item.createdAt.seconds,
              nanoseconds: item.createdAt.nanoseconds,
              id: item.id,
            },
          })),
          exhausted: slice.length < limit,
          nextScanAfter: last
            ? ({
                id: last.id,
                data: () => ({ createdAt: last.createdAt }),
              } as unknown as FirebaseFirestore.QueryDocumentSnapshot)
            : undefined,
        };
      },
    );

    return { getCharityProductBatch };
  };

  it('bounds reads and returns only active non-hidden listings for the requested charity in newest-first order', async () => {
    const records: StoredProduct[] = [
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
        createdAt: new Timestamp(1700000100, 0),
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
        createdAt: new Timestamp(1700000200, 0),
      },
      {
        id: 'p-other-charity',
        name: 'Other Charity Tee',
        price: 8,
        charityId: 'mind',
        status: 'active',
        number: 1,
        userId: 'seller-3',
        createdAt: new Timestamp(1700000300, 0),
      },
      {
        id: 'p-sold',
        name: 'Sold Item',
        price: 8,
        charityId: 'dogs-trust',
        status: 'sold',
        number: 1,
        userId: 'seller-4',
        createdAt: new Timestamp(1700000300, 0),
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
        createdAt: new Timestamp(1700000250, 0),
      },
      {
        id: 'p-zero-qty',
        name: 'Out Of Stock',
        price: 8,
        charityId: 'dogs-trust',
        status: 'active',
        number: 0,
        userId: 'seller-6',
        createdAt: new Timestamp(1700000240, 0),
      },
    ];

    const repo = createBatchRepository(() => records);
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      repo,
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

    // First batch requests limit + 1 (2); follow-up bounded scan requests 100.
    expect(repo.getCharityProductBatch).toHaveBeenNthCalledWith(
      1,
      'dogs-trust',
      2,
      undefined,
    );
    expect(repo.getCharityProductBatch).toHaveBeenNthCalledWith(
      2,
      'dogs-trust',
      100,
      expect.objectContaining({ id: 'p-hidden' }),
    );

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

  it('continues pagination when the page 1 cursor product becomes sold, hidden, or deleted', async () => {
    let records: StoredProduct[] = [
      {
        id: 'p-3',
        name: 'Newest',
        price: 12,
        charityId: 'dogs-trust',
        status: 'active',
        number: 1,
        userId: 'seller-1',
        createdAt: new Timestamp(1700000300, 123456789),
      },
      {
        id: 'p-2',
        name: 'Boundary Item',
        price: 10,
        charityId: 'dogs-trust',
        status: 'active',
        number: 1,
        userId: 'seller-2',
        createdAt: new Timestamp(1700000200, 500000123),
      },
      {
        id: 'p-1',
        name: 'Older Active',
        price: 8,
        charityId: 'dogs-trust',
        status: 'active',
        number: 1,
        userId: 'seller-3',
        createdAt: new Timestamp(1700000200, 500000001),
      },
    ];

    const repo = createBatchRepository(() => records);
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      repo,
      { getById: jest.fn().mockResolvedValue(null) },
      { getById: jest.fn().mockResolvedValue(null) },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    const page1 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 2,
    });
    expect(page1!.data.products.map((p) => p.id)).toEqual(['p-3', 'p-2']);
    expect(page1!.meta.hasMore).toBe(true);
    const cursor = page1!.meta.nextCursor!;

    // Scenario A: cursor product p-2 sells out
    records[1] = { ...records[1], status: 'sold', number: 0 };
    const afterSold = await service.getCharityProducts(
      'dogs-trust',
      'viewer-1',
      {
        limit: 2,
        cursor,
      },
    );
    expect(afterSold!.data.products.map((p) => p.id)).toEqual(['p-1']);
    expect(afterSold!.meta.hasMore).toBe(false);

    // Scenario B: cursor product p-2 is moderation-hidden
    records[1] = { ...records[1], status: 'active', number: 1, hidden: true };
    const afterHidden = await service.getCharityProducts(
      'dogs-trust',
      'viewer-1',
      { limit: 2, cursor },
    );
    expect(afterHidden!.data.products.map((p) => p.id)).toEqual(['p-1']);

    // Scenario C: cursor product p-2 is completely deleted from Firestore
    records = records.filter((item) => item.id !== 'p-2');
    const afterDeleted = await service.getCharityProducts(
      'dogs-trust',
      'viewer-1',
      { limit: 2, cursor },
    );
    expect(afterDeleted!.data.products.map((p) => p.id)).toEqual(['p-1']);
    expect(afterDeleted!.meta.hasMore).toBe(false);
    expect(afterDeleted!.meta.nextCursor).toBeNull();
  });

  it('aborts with an error when scanning exceeds the bounded maximum', async () => {
    const soldChunk: CharityProductBatch = {
      items: Array.from({ length: 100 }, (_, idx) => ({
        product: {
          id: `sold-${idx}`,
          name: 'Sold',
          description: '',
          categoryId: 'cat-1',
          charityId: 'dogs-trust',
          userId: 'seller-1',
          quality: 'Good',
          size: 'M',
          product_images: ['https://example.com/item.jpg'],
          donation: 5,
          price: 5,
          likes: 0,
          number: 0,
          status: 'sold',
        },
        position: {
          seconds: 1700000000 - idx,
          nanoseconds: 0,
          id: `sold-${idx}`,
        },
      })),
      exhausted: false,
      nextScanAfter: {
        id: 'sold-99',
      } as FirebaseFirestore.QueryDocumentSnapshot,
    };
    const getCharityProductBatch = jest.fn().mockResolvedValue(soldChunk);
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      { getCharityProductBatch },
      { getById: jest.fn() },
      { getById: jest.fn() },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    await expect(
      service.getCharityProducts('dogs-trust', 'viewer-1', { limit: 20 }),
    ).rejects.toThrow('Charity product scan limit exceeded');
  });

  it('returns empty listings without querying products when viewer blocked the charity', async () => {
    const getCharityProductBatch = jest.fn();
    const service = new CharityProfileService(
      { getById: jest.fn() },
      { getCharityProductBatch },
      { getById: jest.fn() },
      { getById: jest.fn() },
      { isBlocked: jest.fn().mockResolvedValue(true) },
    );

    const result = await service.getCharityProducts('dogs-trust', 'viewer-1');

    expect(result).toEqual({
      data: { products: [] },
      meta: { limit: 20, nextCursor: null, hasMore: false },
    });
    expect(getCharityProductBatch).not.toHaveBeenCalled();
  });

  it('returns null when the charity does not exist', async () => {
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(null) },
      { getCharityProductBatch: jest.fn() },
      { getById: jest.fn() },
      { getById: jest.fn() },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    await expect(
      service.getCharityProducts('missing', 'viewer-1'),
    ).resolves.toBeNull();
  });

  it('rejects tampered, legacy, or malformed cursors', async () => {
    const repo = createBatchRepository(() => [
      {
        id: 'p-1',
        name: 'Item 1',
        price: 3,
        charityId: 'dogs-trust',
        status: 'active',
        number: 1,
        userId: 'seller-1',
        createdAt: new Timestamp(1700000000, 0),
      },
      {
        id: 'p-2',
        name: 'Item 2',
        price: 4,
        charityId: 'dogs-trust',
        status: 'active',
        number: 1,
        userId: 'seller-1',
        createdAt: new Timestamp(1700000100, 0),
      },
    ]);
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      repo,
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

    const invalidNanoCursor = Buffer.from(
      JSON.stringify({
        v: 2,
        charityId: 'dogs-trust',
        viewerId: 'viewer-1',
        seconds: 1700000100,
        nanoseconds: 1_000_000_000,
        lastId: 'p-2',
      }),
      'utf8',
    ).toString('base64url');
    await expect(
      service.getCharityProducts('dogs-trust', 'viewer-1', {
        cursor: invalidNanoCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidCharityProductCursor);

    const legacyV1Cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        charityId: 'dogs-trust',
        viewerId: 'viewer-1',
        lastId: 'p-2',
      }),
      'utf8',
    ).toString('base64url');
    await expect(
      service.getCharityProducts('dogs-trust', 'viewer-1', {
        cursor: legacyV1Cursor,
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
