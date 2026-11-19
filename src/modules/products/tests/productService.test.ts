import { Product } from '../model/Product';
import { ProductService } from '../services/ProductService';

const createProduct = (
  id: string,
  createdAt: string,
  name = `Product ${id}`,
): Product => ({
  id,
  name,
  description: `${name} description`,
  categoryId: 'category-1',
  charityId: 'charity-1',
  postageSize: 'postage-1',
  userId: 'user-1',
  quality: 'Premium',
  size: 'M',
  product_images: ['https://example.com/image.jpg'],
  donation: 10,
  price: 20,
  likes: 0,
  number: 1,
  status: 'active',
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
});

describe('ProductService pagination', () => {
  const productLikeRepo = {
    getLikedProductsPage: jest.fn(),
    setLikeStatus: jest.fn(),
  } as any;
  const categoryRepo = { getById: jest.fn() } as any;
  const charityRepo = { getById: jest.fn() } as any;
  const postageSizeRepo = { getById: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a stable cursor based on the last returned product', async () => {
    const first = createProduct('product-1', '2026-07-13T10:00:00.000Z');
    const second = createProduct('product-2', '2026-07-13T09:00:00.000Z');
    const third = createProduct('product-3', '2026-07-13T08:00:00.000Z');
    const getPageByFilters = jest
      .fn()
      .mockResolvedValueOnce({
        items: [first, second],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [third],
        hasMore: false,
      });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const pageOne = await service.getPaginatedProducts({ limit: 2 });

    expect(pageOne.items.map((product) => product.id)).toEqual([
      'product-1',
      'product-2',
    ]);
    expect(pageOne.hasMore).toBe(true);
    expect(pageOne.nextCursor).toBeTruthy();

    const pageTwo = await service.getPaginatedProducts({
      limit: 2,
      cursor: pageOne.nextCursor!,
    });

    expect(getPageByFilters).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        limit: 2,
        cursor: pageOne.nextCursor,
      }),
      2,
      {
        createdAt: second.createdAt,
        id: 'product-2',
      },
    );
    expect(pageTwo.items.map((product) => product.id)).toEqual(['product-3']);
    expect(pageTwo.hasMore).toBe(false);
  });

  it('excludes out-of-stock products from marketplace pagination', async () => {
    const availableProduct = createProduct(
      'available-product',
      '2026-07-13T10:00:00.000Z',
    );
    const soldProduct = {
      ...createProduct('sold-product', '2026-07-13T09:00:00.000Z'),
      number: 0,
    };
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [availableProduct, soldProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProducts({ limit: 2 });

    expect(result.items.map((product) => product.id)).toEqual([
      'available-product',
    ]);
  });

  it('excludes unlisted and sold products from marketplace pagination', async () => {
    const availableProduct = createProduct(
      'available-product',
      '2026-07-13T10:00:00.000Z',
    );
    const unlistedProduct = {
      ...createProduct('unlisted-product', '2026-07-13T09:00:00.000Z'),
      status: 'unlisted' as const,
    };
    const soldProduct = {
      ...createProduct('sold-product', '2026-07-13T08:00:00.000Z'),
      number: 0,
      status: 'sold' as const,
    };
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [availableProduct, unlistedProduct, soldProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProducts({ limit: 3 });

    expect(result.items.map((product) => product.id)).toEqual([
      'available-product',
    ]);
  });

  it('excludes moderation-hidden products from marketplace pagination', async () => {
    const availableProduct = createProduct(
      'available-product',
      '2026-07-13T10:00:00.000Z',
    );
    const hiddenProduct = {
      ...createProduct('hidden-product', '2026-07-13T09:00:00.000Z'),
      moderationStatus: 'hidden' as const,
      hidden: true,
    };
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [availableProduct, hiddenProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProducts({ limit: 2 });

    expect(result.items.map((product) => product.id)).toEqual([
      'available-product',
    ]);
  });

  it('rejects malformed cursors', async () => {
    const service = new ProductService(
      { getPageByFilters: jest.fn() } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    await expect(
      service.getPaginatedProducts({ limit: 2, cursor: 'not-a-real-cursor' }),
    ).rejects.toThrow('Invalid cursor');
  });

  it('returns null for a moderation-hidden product detail', async () => {
    const hiddenProduct = {
      ...createProduct('hidden-product', '2026-07-13T10:00:00.000Z'),
      moderationStatus: 'hidden' as const,
    };
    const service = new ProductService(
      { getById: jest.fn().mockResolvedValue(hiddenProduct) } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    await expect(
      service.getVisibleProductById('hidden-product'),
    ).resolves.toBeNull();
  });

  it('scopes my-products pagination to the authenticated user', async () => {
    const ownedProduct = createProduct(
      'owned-product',
      '2026-07-13T10:00:00.000Z',
    );
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [ownedProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProductsByUserId('user-42', {
      limit: 1,
      search: 'owned',
    });

    expect(getPageByFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-42',
        limit: 1,
        search: 'owned',
      }),
      1,
      undefined,
    );
    expect(result.items.map((product) => product.id)).toEqual([
      'owned-product',
    ]);
  });

  it('keeps out-of-stock products visible in my-products pagination', async () => {
    const soldProduct = {
      ...createProduct('sold-product', '2026-07-13T10:00:00.000Z'),
      number: 0,
    };
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [soldProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProductsByUserId('user-42', {
      limit: 1,
    });

    expect(result.items.map((product) => product.id)).toEqual(['sold-product']);
  });

  it('keeps moderation-hidden products visible in my-products pagination', async () => {
    const hiddenProduct = {
      ...createProduct('hidden-product', '2026-07-13T10:00:00.000Z'),
      hidden: true,
      moderationStatus: 'hidden' as const,
    };
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [hiddenProduct],
      hasMore: false,
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedProductsByUserId('user-42', {
      limit: 1,
    });

    expect(result.items.map((product) => product.id)).toEqual([
      'hidden-product',
    ]);
  });

  it('keeps sold products visible in liked products with their status', async () => {
    const soldProduct = {
      ...createProduct('sold-product', '2026-07-13T10:00:00.000Z', 'Sold Coat'),
      number: 0,
      status: 'sold' as const,
    };
    const getById = jest.fn().mockResolvedValueOnce(soldProduct);
    const getLikedProductsPage = jest.fn().mockResolvedValueOnce({
      likes: [
        {
          id: 'user-1_sold-product',
          userId: 'user-1',
          productId: 'sold-product',
          createdAt: new Date('2026-07-13T10:00:00.000Z'),
        },
      ],
      hasMore: false,
    });

    const service = new ProductService(
      { getById, getPageByFilters: jest.fn() } as any,
      { ...productLikeRepo, getLikedProductsPage } as any,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedLikedProductsByUserId('user-1', {
      limit: 1,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'sold-product',
        status: 'sold',
      }),
    ]);
  });

  it('returns liked products for the authenticated user', async () => {
    const likedOne = createProduct(
      'liked-1',
      '2026-07-13T10:00:00.000Z',
      'Blue Hoodie',
    );
    const likedTwo = createProduct(
      'liked-2',
      '2026-07-13T09:00:00.000Z',
      'Green Coat',
    );
    const getById = jest
      .fn()
      .mockResolvedValueOnce(likedOne)
      .mockResolvedValueOnce(likedTwo);
    const getLikedProductsPage = jest.fn().mockResolvedValueOnce({
      likes: [
        {
          id: 'user-1_liked-1',
          userId: 'user-1',
          productId: 'liked-1',
          createdAt: new Date('2026-07-13T10:00:00.000Z'),
        },
        {
          id: 'user-1_liked-2',
          userId: 'user-1',
          productId: 'liked-2',
          createdAt: new Date('2026-07-13T09:00:00.000Z'),
        },
      ],
      hasMore: false,
    });

    const service = new ProductService(
      { getById, getPageByFilters: jest.fn() } as any,
      { ...productLikeRepo, getLikedProductsPage } as any,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.getPaginatedLikedProductsByUserId('user-1', {
      limit: 2,
      search: 'coat',
    });

    expect(getLikedProductsPage).toHaveBeenCalledWith('user-1', 2, undefined);
    expect(result.items.map((product) => product.id)).toEqual(['liked-2']);
    expect(result.hasMore).toBe(false);
  });

  it('uses the last returned liked item for the next cursor', async () => {
    const likedOne = createProduct(
      'liked-1',
      '2026-07-13T10:00:00.000Z',
      'Coat One',
    );
    const likedTwo = createProduct(
      'liked-2',
      '2026-07-13T09:00:00.000Z',
      'Coat Two',
    );
    const getById = jest
      .fn()
      .mockResolvedValueOnce(likedOne)
      .mockResolvedValueOnce(likedTwo);
    const getLikedProductsPage = jest
      .fn()
      .mockResolvedValueOnce({
        likes: [
          {
            id: 'user-1_liked-1',
            userId: 'user-1',
            productId: 'liked-1',
            createdAt: new Date('2026-07-13T10:00:00.000Z'),
          },
          {
            id: 'user-1_liked-2',
            userId: 'user-1',
            productId: 'liked-2',
            createdAt: new Date('2026-07-13T09:00:00.000Z'),
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        likes: [
          {
            id: 'user-1_liked-2',
            userId: 'user-1',
            productId: 'liked-2',
            createdAt: new Date('2026-07-13T09:00:00.000Z'),
          },
        ],
        hasMore: false,
      });

    const service = new ProductService(
      { getById, getPageByFilters: jest.fn() } as any,
      { ...productLikeRepo, getLikedProductsPage } as any,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const firstPage = await service.getPaginatedLikedProductsByUserId(
      'user-1',
      {
        limit: 1,
        search: 'coat',
      },
    );

    expect(firstPage.items.map((product) => product.id)).toEqual(['liked-1']);
    expect(firstPage.nextCursor).toBeTruthy();

    await service.getPaginatedLikedProductsByUserId('user-1', {
      limit: 1,
      search: 'coat',
      cursor: firstPage.nextCursor!,
    });

    const secondCursor = getLikedProductsPage.mock.calls[1][2];
    expect(secondCursor).toEqual({
      createdAt: new Date('2026-07-13T10:00:00.000Z'),
      id: 'user-1_liked-1',
    });
  });

  it('delegates like persistence to the likes repository', async () => {
    const likedProduct = createProduct('liked-1', '2026-07-13T10:00:00.000Z');
    const setLikeStatus = jest.fn().mockResolvedValueOnce({
      product: likedProduct,
      liked: true,
    });

    const service = new ProductService(
      {} as any,
      { ...productLikeRepo, setLikeStatus } as any,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.setProductLikeStatus(
      'user-1',
      'liked-1',
      true,
    );

    expect(setLikeStatus).toHaveBeenCalledWith('user-1', 'liked-1', true);
    expect(result.liked).toBe(true);
    expect(result.product.id).toBe('liked-1');
  });

  it('defaults new products to active', async () => {
    categoryRepo.getById.mockResolvedValue({ id: 'category-1' });
    charityRepo.getById.mockResolvedValue({ id: 'charity-1' });
    postageSizeRepo.getById.mockResolvedValue({ id: 'postage-1' });
    const create = jest.fn().mockImplementation(async (product) => ({
      id: 'new-product',
      ...product,
    }));

    const service = new ProductService(
      { create } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.createProduct({
      name: 'New Coat',
      categoryId: 'category-1',
      charityId: 'charity-1',
      postageSize: 'postage-1',
      userId: 'user-1',
      quality: 'Premium',
      size: 'M',
      product_images: ['https://example.com/image.jpg'],
      donation: 10,
      price: 20,
      number: 1,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
      }),
    );
    expect(result.status).toBe('active');
  });

  it('defaults new products with no stock to sold', async () => {
    categoryRepo.getById.mockResolvedValue({ id: 'category-1' });
    charityRepo.getById.mockResolvedValue({ id: 'charity-1' });
    postageSizeRepo.getById.mockResolvedValue({ id: 'postage-1' });
    const create = jest.fn().mockImplementation(async (product) => ({
      id: 'new-product',
      ...product,
    }));

    const service = new ProductService(
      { create } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );

    const result = await service.createProduct({
      name: 'New Coat',
      categoryId: 'category-1',
      charityId: 'charity-1',
      postageSize: 'postage-1',
      userId: 'user-1',
      quality: 'Premium',
      size: 'M',
      product_images: ['https://example.com/image.jpg'],
      donation: 10,
      price: 20,
      number: 0,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sold',
      }),
    );
    expect(result.status).toBe('sold');
  });

  it('rejects stock changes through the descriptive edit service', async () => {
    const service = new ProductService(
      {} as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
    );
    await expect(
      service.updateProduct(
        'product-1',
        { number: 0 } as any,
        'user-1',
      ),
    ).rejects.toMatchObject({ code: 'LISTING_VALIDATION_FAILED' });
  });

  it('deletes removed owned media after a successful listing edit', async () => {
    const existing = createProduct('product-1', '2026-07-13T10:00:00.000Z');
    existing.product_images = [
      'https://firebasestorage.googleapis.com/v0/b/cherry.appspot.com/o/products%2Fuser-1%2Fkeep.jpg?alt=media',
      'https://firebasestorage.googleapis.com/v0/b/cherry.appspot.com/o/products%2Fuser-1%2Fremove.jpg?alt=media',
      'https://example.com/external.jpg',
    ];
    const updated = { ...existing, product_images: [existing.product_images[0]] };
    const update = jest.fn().mockResolvedValue(updated);
    const deleteCalls: string[] = [];
    const bucket = {
      name: 'cherry.appspot.com',
      file: jest.fn((path: string) => ({
        delete: jest.fn().mockImplementation(async () => {
          deleteCalls.push(path);
        }),
      })),
    };
    const service = new ProductService(
      { getById: jest.fn().mockResolvedValue(existing), update } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      bucket,
    );

    await expect(
      service.updateProduct(
        'product-1',
        { product_images: [existing.product_images[0]] },
        'user-1',
      ),
    ).resolves.toEqual(updated);
    expect(update).toHaveBeenCalledWith(
      'product-1',
      { product_images: [existing.product_images[0]] },
      'user-1',
    );
    expect(deleteCalls).toEqual(['products/user-1/remove.jpg']);
  });

  it.each(['active', 'unlisted'] as const)(
    'delegates %s with the authenticated owner to the atomic repository',
    async (status) => {
      const changeAvailability = jest.fn().mockResolvedValue({ status });
      const service = new ProductService(
        { changeAvailability } as any,
        productLikeRepo,
        categoryRepo,
        charityRepo,
        postageSizeRepo,
      );
      await (status === 'active'
        ? service.relistProduct('product-1', 'user-1')
        : service.unlistProduct('product-1', 'user-1'));
      expect(changeAvailability).toHaveBeenCalledWith(
        'product-1',
        'user-1',
        status,
      );
    },
  );

  it('deletes owned listing media after a safe product deletion', async () => {
    const product = createProduct('product-1', '2026-07-13T10:00:00.000Z');
    product.product_images = [
      'https://firebasestorage.googleapis.com/v0/b/cherry.appspot.com/o/products%2Fuser-1%2Fold.jpg?alt=media',
      'https://example.com/not-owned.jpg',
    ];
    const deleteCalls: string[] = [];
    const productRepo = {
      getById: jest.fn().mockResolvedValue(product),
      changeAvailability: jest.fn().mockResolvedValue(null),
    };
    const bucket = {
      name: 'cherry.appspot.com',
      file: jest.fn((path: string) => ({
        delete: jest.fn().mockImplementation(async () => {
          deleteCalls.push(path);
        }),
      })),
    };
    const service = new ProductService(
      productRepo as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      bucket,
    );

    await expect(service.deleteProduct('product-1', 'user-1')).resolves.toBe(true);
    expect(productRepo.changeAvailability).toHaveBeenCalledWith(
      'product-1',
      'user-1',
      'delete',
    );
    expect(deleteCalls).toEqual([
      'products/user-1/old.jpg',
    ]);
  });

  it('does not delete media when the product deletion fails', async () => {
    const product = createProduct('product-1', '2026-07-13T10:00:00.000Z');
    const productRepo = {
      getById: jest.fn().mockResolvedValue(product),
      changeAvailability: jest.fn().mockRejectedValue(new Error('Payment pending')),
    };
    const bucket = { file: jest.fn() };
    const service = new ProductService(
      productRepo as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      bucket,
    );

    await expect(service.deleteProduct('product-1', 'user-1')).rejects.toThrow('Payment pending');
    expect(bucket.file).not.toHaveBeenCalled();
  });

  it('excludes products from charities blocked by the viewer and preserves remaining pages', async () => {
    const p1 = {
      ...createProduct('p-1', '2026-07-13T10:00:00.000Z'),
      charityId: 'charity-open',
    };
    const p2Blocked = {
      ...createProduct('p-2', '2026-07-13T09:00:00.000Z'),
      charityId: 'charity-blocked',
    };
    const p3 = {
      ...createProduct('p-3', '2026-07-13T08:00:00.000Z'),
      charityId: 'charity-open',
    };
    const p4 = {
      ...createProduct('p-4', '2026-07-13T07:00:00.000Z'),
      charityId: 'charity-open',
    };

    const getPageByFilters = jest
      .fn()
      .mockResolvedValueOnce({ items: [p1, p2Blocked], hasMore: true })
      .mockResolvedValueOnce({ items: [p3, p4], hasMore: false })
      .mockResolvedValueOnce({ items: [p4], hasMore: false });
    const charityBlockRepo = {
      isBlocked: jest.fn(),
      getBlockedCharityIds: jest
        .fn()
        .mockResolvedValue(new Set(['charity-blocked'])),
    };
    categoryRepo.getById.mockResolvedValue({ id: 'category-1', name: 'Tops' });
    charityRepo.getById.mockResolvedValue({
      id: 'charity-open',
      name: 'Open Charity',
    });
    postageSizeRepo.getById.mockResolvedValue({
      id: 'postage-1',
      name: 'Small',
    });

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    const page1 = await service.getPaginatedProductsWithDetails(
      { limit: 2 },
      'viewer-1',
    );

    expect(charityBlockRepo.getBlockedCharityIds).toHaveBeenCalledWith(
      'viewer-1',
    );
    expect(page1.items.map((item) => item.id)).toEqual(['p-1', 'p-3']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    expect(categoryRepo.getById).toHaveBeenCalledTimes(1);
    expect(charityRepo.getById).toHaveBeenCalledTimes(1);
    expect(postageSizeRepo.getById).toHaveBeenCalledTimes(1);

    const page2 = await service.getPaginatedProducts(
      { limit: 2, cursor: page1.nextCursor! },
      'viewer-1',
    );
    expect(getPageByFilters).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 2 }),
      2,
      {
        createdAt: p2Blocked.createdAt,
        id: 'p-2',
      },
    );
    expect(getPageByFilters).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ limit: 2, cursor: page1.nextCursor }),
      2,
      {
        createdAt: p3.createdAt,
        id: 'p-3',
      },
    );
    expect(page2.items.map((item) => item.id)).toEqual(['p-4']);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('bounds raw product scanning when blocked charities fill pages and resumes after the last examined product', async () => {
    const pages = Array.from({ length: 10 }, (_, pageIndex) => {
      const firstIndex = pageIndex * 2 + 1;
      const secondIndex = pageIndex * 2 + 2;
      return [
        {
          ...createProduct(
            `blocked-${firstIndex}`,
            new Date(Date.UTC(2026, 6, 13, 10, 0, 100 - firstIndex)).toISOString(),
          ),
          charityId: 'charity-blocked',
        },
        {
          ...createProduct(
            `blocked-${secondIndex}`,
            new Date(Date.UTC(2026, 6, 13, 10, 0, 100 - secondIndex)).toISOString(),
          ),
          charityId: 'charity-blocked',
        },
      ];
    });
    const openProduct = {
      ...createProduct('open-after-budget', '2026-07-13T09:00:00.000Z'),
      charityId: 'charity-open',
    };

    const getPageByFilters = jest.fn();
    for (const items of pages) {
      getPageByFilters.mockResolvedValueOnce({ items, hasMore: true });
    }
    getPageByFilters.mockResolvedValueOnce({
      items: [openProduct],
      hasMore: false,
    });

    const charityBlockRepo = {
      isBlocked: jest.fn(),
      getBlockedCharityIds: jest
        .fn()
        .mockResolvedValue(new Set(['charity-blocked'])),
    };
    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    const firstResult = await service.getPaginatedProducts(
      { limit: 2 },
      'viewer-1',
    );

    const lastExamined = pages[9][1];
    expect(getPageByFilters).toHaveBeenCalledTimes(10);
    expect(firstResult.items).toEqual([]);
    expect(firstResult.hasMore).toBe(true);
    expect(firstResult.nextCursor).toBeTruthy();

    const nextResult = await service.getPaginatedProducts(
      { limit: 2, cursor: firstResult.nextCursor! },
      'viewer-1',
    );

    expect(getPageByFilters).toHaveBeenNthCalledWith(
      11,
      expect.objectContaining({ limit: 2, cursor: firstResult.nextCursor }),
      2,
      {
        createdAt: lastExamined.createdAt,
        id: lastExamined.id,
      },
    );
    expect(nextResult.items.map((item) => item.id)).toEqual([
      'open-after-budget',
    ]);
    expect(nextResult.hasMore).toBe(false);
    expect(nextResult.nextCursor).toBeNull();
  });

  it('bounds raw product scanning by item budget and returns a continuation cursor from the last examined product on partial pages', async () => {
    const page1Open = {
      ...createProduct('open-1', '2026-07-13T12:00:00.000Z'),
      charityId: 'charity-open',
    };
    const makeBlockedBatch = (batchIndex: number, count: number) =>
      Array.from({ length: count }, (_, itemIndex) => ({
        ...createProduct(
          `blocked-${batchIndex}-${itemIndex}`,
          new Date(
            Date.UTC(2026, 6, 13, 11, 59 - batchIndex, 59 - itemIndex),
          ).toISOString(),
        ),
        charityId: 'charity-blocked',
      }));

    const batch1 = [page1Open, ...makeBlockedBatch(0, 49)];
    const batch2 = makeBlockedBatch(1, 50);
    const batch3 = makeBlockedBatch(2, 50);
    const batch4 = makeBlockedBatch(3, 50);
    const batch5 = makeBlockedBatch(4, 50);
    const page6Open = {
      ...createProduct('open-2', '2026-07-13T10:00:00.000Z'),
      charityId: 'charity-open',
    };

    const getPageByFilters = jest
      .fn()
      .mockResolvedValueOnce({ items: batch1, hasMore: true })
      .mockResolvedValueOnce({ items: batch2, hasMore: true })
      .mockResolvedValueOnce({ items: batch3, hasMore: true })
      .mockResolvedValueOnce({ items: batch4, hasMore: true })
      .mockResolvedValueOnce({ items: batch5, hasMore: true })
      .mockResolvedValueOnce({ items: [page6Open], hasMore: false });

    const charityBlockRepo = {
      isBlocked: jest.fn(),
      getBlockedCharityIds: jest
        .fn()
        .mockResolvedValue(new Set(['charity-blocked'])),
    };
    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    const partialPage = await service.getPaginatedProducts(
      { limit: 50 },
      'viewer-1',
    );

    const lastExamined = batch5[batch5.length - 1];
    expect(getPageByFilters).toHaveBeenCalledTimes(5);
    expect(partialPage.items.map((item) => item.id)).toEqual(['open-1']);
    expect(partialPage.hasMore).toBe(true);
    expect(partialPage.nextCursor).toBeTruthy();

    const nextPage = await service.getPaginatedProducts(
      { limit: 50, cursor: partialPage.nextCursor! },
      'viewer-1',
    );

    expect(getPageByFilters).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ limit: 50, cursor: partialPage.nextCursor }),
      50,
      {
        createdAt: lastExamined.createdAt,
        id: lastExamined.id,
      },
    );
    expect(nextPage.items.map((item) => item.id)).toEqual(['open-2']);
    expect(nextPage.hasMore).toBe(false);
    expect(nextPage.nextCursor).toBeNull();
  });

  it('returns empty listings without querying products when requested charityId is blocked', async () => {
    const getPageByFilters = jest.fn();
    const charityBlockRepo = {
      isBlocked: jest.fn().mockResolvedValue(true),
      getBlockedCharityIds: jest.fn(),
    };

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    const result = await service.getPaginatedProductsWithDetails(
      { charityId: 'charity-blocked', limit: 20 },
      'viewer-1',
    );

    expect(charityBlockRepo.isBlocked).toHaveBeenCalledWith(
      'viewer-1',
      'charity-blocked',
    );
    expect(charityBlockRepo.getBlockedCharityIds).not.toHaveBeenCalled();
    expect(getPageByFilters).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      limit: 20,
      nextCursor: null,
      hasMore: false,
    });
  });

  it('binds pagination cursors to the authenticated viewer', async () => {
    const first = createProduct('product-1', '2026-07-13T10:00:00.000Z');
    const second = createProduct('product-2', '2026-07-13T09:00:00.000Z');
    const getPageByFilters = jest.fn().mockResolvedValueOnce({
      items: [first, second],
      hasMore: true,
    });
    const charityBlockRepo = {
      isBlocked: jest.fn().mockResolvedValue(false),
      getBlockedCharityIds: jest.fn().mockResolvedValue(new Set<string>()),
    };

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    const page1 = await service.getPaginatedProducts(
      { charityId: 'charity-1', limit: 2 },
      'viewer-1',
    );

    await expect(
      service.getPaginatedProducts(
        { charityId: 'charity-1', limit: 2, cursor: page1.nextCursor! },
        'viewer-2',
      ),
    ).rejects.toThrow('Invalid cursor');
  });

  it('propagates errors when checking blocked charities fails', async () => {
    const getPageByFilters = jest.fn();
    const charityBlockRepo = {
      isBlocked: jest.fn().mockRejectedValue(new Error('Firestore down')),
      getBlockedCharityIds: jest
        .fn()
        .mockRejectedValue(new Error('Firestore down')),
    };

    const service = new ProductService(
      { getPageByFilters } as any,
      productLikeRepo,
      categoryRepo,
      charityRepo,
      postageSizeRepo,
      undefined,
      charityBlockRepo,
    );

    await expect(
      service.getPaginatedProducts({ charityId: 'charity-1' }, 'viewer-1'),
    ).rejects.toThrow('Firestore down');
    await expect(
      service.getPaginatedProducts({}, 'viewer-1'),
    ).rejects.toThrow('Firestore down');
    expect(getPageByFilters).not.toHaveBeenCalled();
  });
});
