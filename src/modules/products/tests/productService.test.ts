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
      service.updateProduct('product-1', { number: 0 } as any, 'user-1'),
    ).rejects.toMatchObject({ code: 'LISTING_VALIDATION_FAILED' });
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

  it.each([false, true])('delegates deletion without accessing Storage (failure=%s)', async (fails) => {
    const getStorage = jest.spyOn(require('firebase-admin/storage'), 'getStorage');
    const changeAvailability = fails
      ? jest.fn().mockRejectedValue(new Error('Payment pending'))
      : jest.fn().mockResolvedValue(null);
    const service = new ProductService(
      { changeAvailability } as any,
      productLikeRepo, categoryRepo, charityRepo, postageSizeRepo,
    );
    try {
      const deletion = service.deleteProduct('product-1', 'user-1');
      if (fails) await expect(deletion).rejects.toThrow('Payment pending');
      else await expect(deletion).resolves.toBe(true);
      expect(changeAvailability).toHaveBeenCalledWith('product-1', 'user-1', 'delete');
      expect(getStorage).not.toHaveBeenCalled();
    } finally {
      getStorage.mockRestore();
    }
  });

});

describe('listing edit rollout and media boundary', () => {
  const enabled = process.env.LISTING_EDIT_ENABLED;
  const existing = createProduct('product-1', '2026-01-01');
  const getById = jest.fn();
  const update = jest.fn();
  const validatePhotos = jest.fn();
  const service = new ProductService(
    { getById, update } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { validatePhotos } as any,
  );
  beforeEach(() => {
    getById.mockReset().mockResolvedValue(existing);
    update.mockReset().mockResolvedValue({ ...existing, editVersion: 1 });
    validatePhotos.mockReset().mockResolvedValue(undefined);
    process.env.LISTING_EDIT_ENABLED = 'true';
  });
  afterEach(() => {
    if (enabled === undefined) delete process.env.LISTING_EDIT_ENABLED;
    else process.env.LISTING_EDIT_ENABLED = enabled;
  });
  test('editing stays disabled until explicitly enabled', async () => {
    delete process.env.LISTING_EDIT_ENABLED;
    await expect(
      service.updateProduct(
        'product-1',
        { expectedEditVersion: 0, name: 'New title' },
        'user-1',
      ),
    ).rejects.toHaveProperty('code', 'LISTING_EDIT_DISABLED');
    expect(update).not.toHaveBeenCalled();
    expect(validatePhotos).not.toHaveBeenCalled();
  });
  test('a text-only edit still validates retained photos before writing', async () => {
    await service.updateProduct(
      'product-1',
      { expectedEditVersion: 0, name: 'New title' },
      'user-1',
    );
    expect(validatePhotos).toHaveBeenCalledWith(
      existing.product_images,
      'user-1',
    );
    expect(update).toHaveBeenCalledWith(
      'product-1',
      { expectedEditVersion: 0, name: 'New title' },
      'user-1',
    );
  });
  test('unauthorised edits cannot read or validate storage', async () => {
    await expect(
      service.updateProduct(
        'product-1',
        { expectedEditVersion: 0, name: 'New title' },
        'other',
      ),
    ).rejects.toHaveProperty('code', 'LISTING_NOT_OWNER');
    expect(validatePhotos).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  test('replacing photos validates the new photos without immediately deleting old files', async () => {
    const getStorage = jest.spyOn(require('firebase-admin/storage'), 'getStorage');
    const product_images = ['https://example.com/replacement.jpg'];
    try {
      await service.updateProduct(
        'product-1',
        { expectedEditVersion: 0, product_images },
        'user-1',
      );
      expect(validatePhotos).toHaveBeenCalledWith(product_images, 'user-1');
      expect(update).toHaveBeenCalledWith(
        'product-1', { expectedEditVersion: 0, product_images }, 'user-1',
      );
      expect(getStorage).not.toHaveBeenCalled();
    } finally {
      getStorage.mockRestore();
    }
  });
  test('unverifiable media prevents an otherwise valid edit', async () => {
    validatePhotos.mockRejectedValue(new Error('Unverified photo'));
    await expect(
      service.updateProduct(
        'product-1',
        { expectedEditVersion: 0, name: 'New title' },
        'user-1',
      ),
    ).rejects.toThrow('Unverified photo');
    expect(update).not.toHaveBeenCalled();
  });
});
