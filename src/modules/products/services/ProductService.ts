import { Product } from '../model/Product';
import { Category } from '../../categories/model/Category';
import { Charity } from '../../charities/model/Charity';
import {
    ProductListFilters,
    ProductQueryCursor,
    ProductRepository,
} from '../repositories/ProductRepository';
import {
    ProductLikeCursor,
    ProductLikeRepository,
} from '../repositories/ProductLikeRepository';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { CharityRepository } from '../../charities/repositories/CharityRepository';
import { PostageSize } from '../../postage-sizes/model/PostageSize';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { productBelongsToUser } from '../utils/productOwnership';

const DEFAULT_PRODUCT_PAGE_SIZE = 20;
const MAX_PRODUCT_PAGE_SIZE = 50;

export class ProductService {
    constructor(
        private productRepo: ProductRepository,
        private productLikeRepo: ProductLikeRepository,
        private categoryRepo: CategoryRepository,
        private charityRepo: CharityRepository,
        private postageSizeRepo: PostageSizeRepository
    ) {}

    async getAllProducts(): Promise<Product[]> {
        return this.productRepo.getAll();
    }

    async getPaginatedProducts(
        query: ProductListQuery,
    ): Promise<PaginatedResult<Product>> {
        return this.getProductPage(query);
    }

    async getPaginatedProductsByUserId(
        userId: string,
        query: ProductListQuery,
    ): Promise<PaginatedResult<Product>> {
        return this.getProductPage({
            ...query,
            userId,
        });
    }

    async getPaginatedLikedProductsByUserId(
        userId: string,
        query: ProductListQuery,
    ): Promise<PaginatedResult<Product>> {
        const limit = this.normalizeLimit(query.limit);
        const cursor = this.decodeLikedCursor(query.cursor, query);
        const items: Product[] = [];
        let pageCursor = cursor;
        let hasMore = false;

        do {
            const page = await this.productLikeRepo.getLikedProductsPage(
                userId,
                limit,
                pageCursor,
            );

            const likedProducts = await Promise.all(
                page.likes.map(async (like) => ({
                    like,
                    product: await this.productRepo.getById(like.productId),
                })),
            );

            const matchedEntries = likedProducts.filter((entry) => Boolean(entry.product)).filter((entry) =>
                this.applyProductFilters(
                    this.applySearch([entry.product as Product], query.search),
                    query,
                ).length > 0,
            );

            let lastReturnedLike: ProductLikeCursor | null = null;
            for (const entry of matchedEntries) {
                if (items.length < limit) {
                    items.push(entry.product as Product);
                    lastReturnedLike = {
                        createdAt: entry.like.createdAt,
                        id: entry.like.id,
                    };
                }
            }

            if (items.length >= limit) {
                return {
                    items,
                    limit,
                    nextCursor: page.hasMore && lastReturnedLike
                        ? this.encodeLikedCursor(
                            lastReturnedLike.createdAt,
                            lastReturnedLike.id,
                            query,
                        )
                        : null,
                    hasMore: page.hasMore,
                };
            }

            if (!page.likes.length || !page.hasMore) {
                hasMore = false;
                break;
            }

            const lastLike = page.likes[page.likes.length - 1];
            pageCursor = {
                createdAt: lastLike.createdAt,
                id: lastLike.id,
            };
            hasMore = true;
        } while (items.length < limit);

        return {
            items,
            limit,
            nextCursor: null,
            hasMore,
        };
    }

    async getProductById(id: string): Promise<Product | null> {
        return this.productRepo.getById(id);
    }

    async getProductsByUserId(userId: string): Promise<Product[]> {
        return this.productRepo.getByUserId(userId);
    }

    async createProduct(data: CreateProductData & { userId: string }): Promise<Product> {
        // Validate that category and charity exist
        await this.validateReferences(
            data.categoryId,
            data.charityId,
            data.postageSize,
        );
        
        const product: Product = {
            ...data,
            likes: data.likes || 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        return this.productRepo.create(product);
    }

    async getProductWithDetails(id: string): Promise<ProductWithDetails | null> {
        const product = await this.productRepo.getById(id);
        if (!product) {
            return null;
        }

        // Only fetch category and charity if IDs exist and are valid strings
        const categoryPromise = product.categoryId && typeof product.categoryId === 'string' && product.categoryId.trim()
            ? this.categoryRepo.getById(product.categoryId)
            : Promise.resolve(null);
        
        const charityPromise = product.charityId && typeof product.charityId === 'string' && product.charityId.trim()
            ? this.charityRepo.getById(product.charityId)
            : Promise.resolve(null);

        const [category, charity, postageSizeDetails] = await Promise.all([
            categoryPromise,
            charityPromise,
            product.postageSize
                ? this.postageSizeRepo.getById(product.postageSize)
                : Promise.resolve(null),
        ]);

        return {
            ...product,
            category: category || undefined,
            charity: charity || undefined,
            postageSizeDetails: postageSizeDetails || undefined,
        };
    }

    async getAllProductsWithDetails(): Promise<ProductWithDetails[]> {
        const products = await this.productRepo.getAll();
        return this.enrichProductsWithDetails(products);
    }

    async getPaginatedProductsWithDetails(
        query: ProductListQuery,
    ): Promise<PaginatedResult<ProductWithDetails>> {
        const paginated = await this.getProductPage(query);
        const items = await this.enrichProductsWithDetails(paginated.items);

        return {
            ...paginated,
            items,
        };
    }

    async getProductsByCategory(categoryId: string): Promise<Product[]> {
        // Validate category exists
        const category = await this.categoryRepo.getById(categoryId);
        if (!category) {
            throw new Error('Category not found');
        }

        return this.productRepo.getProductsByCategory(categoryId);
    }

    async getProductsByCharity(charityId: string): Promise<Product[]> {
        // Validate charity exists
        const charity = await this.charityRepo.getById(charityId);
        if (!charity) {
            throw new Error('Charity not found');
        }

        return this.productRepo.getProductsByCharity(charityId);
    }

    async updateProduct(id: string, data: UpdateProductData): Promise<Product | null> {
        // Check if product exists
        const existingProduct = await this.productRepo.getById(id);
        if (!existingProduct) {
            return null;
        }

        // Validate category and charity references if they are being updated
        if (data.categoryId || data.charityId) {
            const categoryId = data.categoryId || existingProduct.categoryId;
            const charityId = data.charityId || existingProduct.charityId;
            
            if (categoryId && charityId) {
                await this.validateCategoryAndCharity(categoryId, charityId);
            }
        }

        if (data.postageSize) {
            await this.validatePostageSize(data.postageSize);
        }

        return this.productRepo.update(id, data);
    }

    async deleteProduct(id: string): Promise<boolean> {
      return this.productRepo.delete(id);
    }
  
    /**
     * Adjust the product's likes/points by a signed delta.
     * Positive delta increments, negative delta decrements.
     */
    async changePoints(id: string, delta: number): Promise<Product | null> {
      // Ensure the product exists
      const product = await this.productRepo.getById(id);
      if (!product) {
        return null;
      }
      // Delegate to repository's atomic adjustLikes method
      return this.productRepo.adjustLikes(id, delta);
    }

    async setProductLikeStatus(
        userId: string,
        productId: string,
        like: boolean,
    ): Promise<{ product: Product; liked: boolean }> {
        return this.productLikeRepo.setLikeStatus(userId, productId, like);
    }
  
    private async validateReferences(
        categoryId: string,
        charityId: string,
        postageSize: string,
    ): Promise<void> {
        await Promise.all([
            this.validateCategoryAndCharity(categoryId, charityId),
            this.validatePostageSize(postageSize),
        ]);
    }

    private async validateCategoryAndCharity(categoryId: string, charityId: string): Promise<void> {
        const [category, charity] = await Promise.all([
            this.categoryRepo.getById(categoryId),
            this.charityRepo.getById(charityId)
        ]);
        
        if (!category) {
            throw new Error('Category not found');
        }
        
        if (!charity) {
            throw new Error('Charity not found');
        }
    }

    private async validatePostageSize(postageSizeId: string): Promise<void> {
        const postageSize = await this.postageSizeRepo.getById(postageSizeId);
        if (!postageSize) {
            throw new Error('Postage size not found');
        }
    }

    private async enrichProductsWithDetails(
        products: Product[],
    ): Promise<ProductWithDetails[]> {
        return Promise.all(
            products.map(async (product) => {
                try {
                    const categoryPromise = product.categoryId &&
                                          product.categoryId.trim().length > 0
                        ? this.categoryRepo.getById(product.categoryId).catch(() => null)
                        : Promise.resolve(null);

                    const charityPromise = product.charityId &&
                                         typeof product.charityId === 'string' &&
                                         product.charityId.trim().length > 0
                        ? this.charityRepo.getById(product.charityId).catch(() => null)
                        : Promise.resolve(null);

                    const postageSizePromise = product.postageSize
                        ? this.postageSizeRepo.getById(product.postageSize).catch(() => null)
                        : Promise.resolve(null);

                    const [category, charity, postageSizeDetails] = await Promise.all([
                        categoryPromise,
                        charityPromise,
                        postageSizePromise,
                    ]);

                    return {
                        ...product,
                        category: category || undefined,
                        charity: charity || undefined,
                        postageSizeDetails: postageSizeDetails || undefined,
                    };
                } catch (error) {
                    console.error(`Error fetching details for product ${product.id}:`, error);
                    return {
                        ...product,
                        category: undefined,
                        charity: undefined,
                        postageSizeDetails: undefined,
                    };
                }
            })
        );
    }

    private async getProductPage<T extends Product>(
        query: ProductListQuery,
    ): Promise<PaginatedResult<T>> {
        const limit = this.normalizeLimit(query.limit);
        const cursor = this.decodeCursor(query.cursor, query);
        const items: T[] = [];
        let pageCursor = cursor;
        let hasMore = false;

        do {
            const page = await this.productRepo.getPageByFilters(
                query,
                limit,
                pageCursor,
            );

            const matchedItems = this.applyProductFilters(
                this.applySearch(page.items as T[], query.search),
                query,
            );
            for (const item of matchedItems) {
                if (items.length < limit) {
                    items.push(item);
                }
            }

            if (items.length >= limit) {
                const lastItem = items[items.length - 1];
                return {
                    items,
                    limit,
                    nextCursor: page.hasMore
                        ? this.encodeCursor(lastItem, query)
                        : null,
                    hasMore: page.hasMore,
                };
            }

            if (!page.items.length || !page.hasMore) {
                hasMore = false;
                break;
            }

            pageCursor = this.buildCursorFromProduct(page.items[page.items.length - 1], query);
            hasMore = true;
        } while (items.length < limit);

        return {
            items,
            limit,
            nextCursor: hasMore && items.length
                ? this.encodeCursor(items[items.length - 1], query)
                : null,
            hasMore,
        };
    }

    private applySearch<T extends Product>(products: T[], search?: string): T[] {
        const normalizedSearch = search?.trim().toLowerCase();
        if (!normalizedSearch) {
            return products;
        }

        return products.filter((product) => {
            const haystack = [
                product.name,
                product.description,
                product.size,
                product.quality,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return haystack.includes(normalizedSearch);
        });
    }

    private applyProductFilters<T extends Product>(
        products: T[],
        query: ProductListQuery,
    ): T[] {
        return products.filter((product) => {
            if (
                query.excludeUserId &&
                productBelongsToUser(product, query.excludeUserId)
            ) {
                return false;
            }

            if (query.categoryId && product.categoryId !== query.categoryId) {
                return false;
            }

            if (query.charityId && product.charityId !== query.charityId) {
                return false;
            }

            if (query.size && product.size !== query.size) {
                return false;
            }

            if (query.quality && product.quality !== query.quality) {
                return false;
            }

            if (typeof query.minPrice === 'number' && product.price < query.minPrice) {
                return false;
            }

            if (typeof query.maxPrice === 'number' && product.price > query.maxPrice) {
                return false;
            }

            return true;
        });
    }

    private normalizeLimit(limit?: number): number {
        if (!limit || Number.isNaN(limit)) {
            return DEFAULT_PRODUCT_PAGE_SIZE;
        }

        return Math.min(Math.max(limit, 1), MAX_PRODUCT_PAGE_SIZE);
    }

    private encodeCursor(product: Product, query: ProductListQuery): string {
        return Buffer.from(JSON.stringify({
            createdAt: this.requireProductCreatedAt(product).toISOString(),
            id: product.id,
            signature: this.buildQuerySignature(query),
        }), 'utf8').toString('base64');
    }

    private decodeCursor(
        cursor: string | undefined,
        query: ProductListQuery,
    ): ProductQueryCursor | undefined {
        if (!cursor) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(
                Buffer.from(cursor, 'base64').toString('utf8'),
            ) as { createdAt?: string; id?: string; signature?: string };

            if (
                !parsed.createdAt ||
                !parsed.id ||
                parsed.signature !== this.buildQuerySignature(query)
            ) {
                throw new Error('Invalid cursor');
            }

            const createdAt = new Date(parsed.createdAt);
            if (Number.isNaN(createdAt.getTime())) {
                throw new Error('Invalid cursor');
            }

            return {
                createdAt,
                id: parsed.id,
            };
        } catch (error) {
            throw new Error('Invalid cursor');
        }
    }

    private encodeLikedCursor(
        createdAt: Date,
        id: string,
        query: ProductListQuery,
    ): string {
        return Buffer.from(JSON.stringify({
            createdAt: createdAt.toISOString(),
            id,
            signature: this.buildQuerySignature(query),
            type: 'liked',
        }), 'utf8').toString('base64');
    }

    private decodeLikedCursor(
        cursor: string | undefined,
        query: ProductListQuery,
    ): ProductLikeCursor | undefined {
        if (!cursor) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(
                Buffer.from(cursor, 'base64').toString('utf8'),
            ) as { createdAt?: string; id?: string; signature?: string; type?: string };

            if (
                !parsed.createdAt ||
                !parsed.id ||
                parsed.signature !== this.buildQuerySignature(query) ||
                parsed.type !== 'liked'
            ) {
                throw new Error('Invalid cursor');
            }

            const createdAt = new Date(parsed.createdAt);
            if (Number.isNaN(createdAt.getTime())) {
                throw new Error('Invalid cursor');
            }

            return {
                createdAt,
                id: parsed.id,
            };
        } catch (error) {
            throw new Error('Invalid cursor');
        }
    }

    private buildCursorFromProduct(
        product: Product,
        query: ProductListQuery,
    ): ProductQueryCursor {
        const encoded = this.encodeCursor(product, query);
        return this.decodeCursor(encoded, query)!;
    }

    private requireProductCreatedAt(product: Product): Date {
        if (!(product.createdAt instanceof Date) || Number.isNaN(product.createdAt.getTime())) {
            throw new Error(`Product ${product.id || 'unknown'} is missing a valid createdAt value`);
        }

        return product.createdAt;
    }

    private buildQuerySignature(query: ProductListQuery): string {
        return JSON.stringify({
            search: query.search?.trim().toLowerCase() || '',
            categoryId: query.categoryId || '',
            charityId: query.charityId || '',
            size: query.size || '',
            quality: query.quality || '',
            minPrice: query.minPrice ?? null,
            maxPrice: query.maxPrice ?? null,
            excludeUserId: query.excludeUserId || '',
        });
    }

}

export interface ProductWithDetails extends Product {
    category?: Category;
    charity?: Charity;
    postageSizeDetails?: PostageSize;
}

export interface CreateProductData {
    name: string;
    description?: string;
    categoryId: string;
    charityId: string;
    postageSize: string;
    quality: string;
    size: string;
    product_images: string[];
    donation: number;
    price: number;
    likes?: number;
    number: number;
}

export interface UpdateProductData {
    name?: string;
    description?: string;
    categoryId?: string;
    charityId?: string;
    postageSize?: string;
    quality?: string;
    size?: string;
    product_images?: string[];
    donation?: number;
    price?: number;
    likes?: number;
    number?: number;
}

export interface ProductListQuery extends ProductListFilters {
    limit?: number;
    cursor?: string;
    search?: string;
    excludeUserId?: string;
}

export interface PaginatedResult<T> {
    items: T[];
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
}
