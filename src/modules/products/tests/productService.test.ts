import { Product } from '../model/Product';
import { ProductService } from '../services/ProductService';

const createProduct = (id: string, createdAt: string, name = `Product ${id}`): Product => ({
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

    it('scopes my-products pagination to the authenticated user', async () => {
        const ownedProduct = createProduct('owned-product', '2026-07-13T10:00:00.000Z');
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
        expect(result.items.map((product) => product.id)).toEqual(['owned-product']);
    });

    it('returns liked products for the authenticated user', async () => {
        const likedOne = createProduct('liked-1', '2026-07-13T10:00:00.000Z', 'Blue Hoodie');
        const likedTwo = createProduct('liked-2', '2026-07-13T09:00:00.000Z', 'Green Coat');
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
        const likedOne = createProduct('liked-1', '2026-07-13T10:00:00.000Z', 'Coat One');
        const likedTwo = createProduct('liked-2', '2026-07-13T09:00:00.000Z', 'Coat Two');
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

        const firstPage = await service.getPaginatedLikedProductsByUserId('user-1', {
            limit: 1,
            search: 'coat',
        });

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

        const result = await service.setProductLikeStatus('user-1', 'liked-1', true);

        expect(setLikeStatus).toHaveBeenCalledWith('user-1', 'liked-1', true);
        expect(result.liked).toBe(true);
        expect(result.product.id).toBe('liked-1');
    });
});
