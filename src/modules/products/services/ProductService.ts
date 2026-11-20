import { parseListingEdit } from '../validators/productValidator';
import {
  assertOwner,
  ListingSafetyError,
} from '../../../shared/utils/listingSafety';
import { Product, ProductStatus } from '../model/Product';
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
import { getStorage } from 'firebase-admin/storage';
import { Timestamp } from 'firebase-admin/firestore';

const DEFAULT_PRODUCT_PAGE_SIZE = 20;
const MAX_PRODUCT_PAGE_SIZE = 50;
const MAX_PRODUCT_SCAN_PAGES = 10;
const MAX_PRODUCT_SCAN_ITEMS = 250;

export interface CharityBlockReader {
  isBlocked(blockerId: string, blockedCharityId: string): Promise<boolean>;
  getBlockedCharityIds(blockerId: string): Promise<Set<string>>;
}

interface StorageFileLike {
  delete(): Promise<unknown>;
}

interface StorageBucketLike {
  name?: string;
  file(path: string): StorageFileLike;
}

export class ProductService {
  constructor(
    private productRepo: ProductRepository,
    private productLikeRepo: ProductLikeRepository,
    private categoryRepo: CategoryRepository,
    private charityRepo: CharityRepository,
    private postageSizeRepo: PostageSizeRepository,
    private mediaBucket?: StorageBucketLike,
    private charityBlockRepo?: CharityBlockReader,
  ) {}

  async getAllProducts(): Promise<Product[]> {
    return this.productRepo.getAll();
  }

  async getPaginatedProducts(
    query: ProductListQuery,
    viewerId?: string,
  ): Promise<PaginatedResult<Product>> {
    return this.getProductPage(query, { availableOnly: true }, viewerId);
  }

  async getPaginatedProductsByUserId(
    userId: string,
    query: ProductListQuery,
  ): Promise<PaginatedResult<Product>> {
    return this.getProductPage(
      {
        ...query,
        userId,
      },
      { includeModerationHidden: true },
    );
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

      const matchedEntries = likedProducts
        .filter((entry) => Boolean(entry.product))
        .filter(
          (entry) =>
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
          nextCursor:
            page.hasMore && lastReturnedLike
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

  async getVisibleProductById(id: string): Promise<Product | null> {
    const product = await this.productRepo.getById(id);
    if (!product || this.isModerationHidden(product)) {
      return null;
    }
    return product;
  }

  async getProductsByUserId(userId: string): Promise<Product[]> {
    return this.productRepo.getByUserId(userId);
  }

  async createProduct(
    data: CreateProductData & { userId: string },
  ): Promise<Product> {
    // Validate that category and charity exist
    await this.validateReferences(
      data.categoryId,
      data.charityId,
      data.postageSize,
    );
    const product: Product = {
      ...data,
      likes: data.likes || 0,
      status: this.statusForStock(data.number),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.productRepo.create(product);
  }

  async getProductWithDetails(id: string): Promise<ProductWithDetails | null> {
    const product = await this.productRepo.getById(id);
    if (!product) {
      return null;
    }

    // Only fetch category and charity if IDs exist and are valid strings
    const categoryPromise =
      product.categoryId &&
      typeof product.categoryId === 'string' &&
      product.categoryId.trim()
        ? this.categoryRepo.getById(product.categoryId)
        : Promise.resolve(null);

    const charityPromise =
      product.charityId &&
      typeof product.charityId === 'string' &&
      product.charityId.trim()
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

  async getVisibleProductWithDetails(
    id: string,
  ): Promise<ProductWithDetails | null> {
    const product = await this.getVisibleProductById(id);
    if (!product) {
      return null;
    }

    const categoryPromise =
      product.categoryId &&
      typeof product.categoryId === 'string' &&
      product.categoryId.trim()
        ? this.categoryRepo.getById(product.categoryId)
        : Promise.resolve(null);

    const charityPromise =
      product.charityId &&
      typeof product.charityId === 'string' &&
      product.charityId.trim()
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
    viewerId?: string,
  ): Promise<PaginatedResult<ProductWithDetails>> {
    const paginated = await this.getProductPage(
      query,
      { availableOnly: true },
      viewerId,
    );
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

  async updateProduct(
    id: string,
    data: UpdateProductData,
    uid: string,
  ): Promise<Product> {
    const validated = parseListingEdit(data);
    const existing = await this.productRepo.getById(id);
    if (!existing)
      throw new ListingSafetyError(
        404,
        'LISTING_NOT_FOUND',
        'Listing not found.',
      );
    assertOwner(existing, uid);
    const updated = await this.productRepo.update(id, validated, uid);
    if (validated.product_images) {
      const retainedImages = new Set(validated.product_images);
      const removedImages = existing.product_images.filter(
        (image) => !retainedImages.has(image),
      );
      await this.deleteProductMedia(id, removedImages, uid);
    }
    return updated;
  }

  async deleteProduct(id: string, uid: string): Promise<boolean> {
    const product = await this.productRepo.getById(id);
    await this.productRepo.changeAvailability(id, uid, 'delete');
    if (product) {
      await this.deleteProductMedia(id, product.product_images, uid);
    }
    return true;
  }

  private async deleteProductMedia(
    productId: string,
    imageUrls: string[],
    uid: string,
  ): Promise<void> {
    const configuredBucket = this.mediaBucket;
    const paths = [...new Set(
      imageUrls
        .map((url) => this.storagePathForOwnedMedia(url, uid, configuredBucket?.name))
        .filter((path): path is string => path !== null),
    )];
    if (paths.length === 0) return;

    const bucket = configuredBucket ?? (getStorage().bucket() as StorageBucketLike);

    const results = await Promise.allSettled(
      paths.map((path) => bucket.file(path).delete()),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      console.error('Product media cleanup failed', {
        productId,
        failedFiles: failures.length,
        totalFiles: paths.length,
      });
    }
  }

  private storagePathForOwnedMedia(
    value: string,
    uid: string,
    bucketName?: string,
  ): string | null {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    let urlBucket: string | undefined;
    let objectPath: string | undefined;
    if (parsed.protocol === 'gs:') {
      urlBucket = parsed.hostname;
      objectPath = decodeURIComponent(parsed.pathname.slice(1));
    } else if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (match) {
        urlBucket = decodeURIComponent(match[1]);
        objectPath = decodeURIComponent(match[2]);
      }
    } else if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 1) {
        urlBucket = decodeURIComponent(parts[0]);
        objectPath = decodeURIComponent(parts.slice(1).join('/'));
      }
    }

    if (!objectPath || (bucketName && urlBucket && urlBucket !== bucketName)) {
      return null;
    }

    const allowedPrefixes = [`products/${uid}/`];
    return allowedPrefixes.some((prefix) => objectPath.startsWith(prefix))
      ? objectPath
      : null;
  }

  async unlistProduct(id: string, uid: string): Promise<Product | null> {
    return this.productRepo.changeAvailability(id, uid, 'unlisted');
  }

  async relistProduct(id: string, uid: string): Promise<Product | null> {
    return this.productRepo.changeAvailability(id, uid, 'active');
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

  private async validateCategoryAndCharity(
    categoryId: string,
    charityId: string,
  ): Promise<void> {
    const [category, charity] = await Promise.all([
      this.categoryRepo.getById(categoryId),
      this.charityRepo.getById(charityId),
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
    const categoryCache = new Map<string, Promise<Category | null>>();
    const charityCache = new Map<string, Promise<Charity | null>>();
    const postageSizeCache = new Map<string, Promise<PostageSize | null>>();

    const cachedGet = <T>(
      cache: Map<string, Promise<T | null>>,
      rawId: unknown,
      loader: (id: string) => Promise<T | null>,
    ): Promise<T | null> => {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) return Promise.resolve(null);
      if (!cache.has(id)) {
        cache.set(
          id,
          loader(id).catch(() => null),
        );
      }
      return cache.get(id)!;
    };

    return Promise.all(
      products.map(async (product) => {
        try {
          const [category, charity, postageSizeDetails] = await Promise.all([
            cachedGet(categoryCache, product.categoryId, (id) =>
              this.categoryRepo.getById(id),
            ),
            cachedGet(charityCache, product.charityId, (id) =>
              this.charityRepo.getById(id),
            ),
            cachedGet(postageSizeCache, product.postageSize, (id) =>
              this.postageSizeRepo.getById(id),
            ),
          ]);

          return {
            ...product,
            category: category || undefined,
            charity: charity || undefined,
            postageSizeDetails: postageSizeDetails || undefined,
          };
        } catch (error) {
          console.error(
            `Error fetching details for product ${product.id}:`,
            error,
          );
          return {
            ...product,
            category: undefined,
            charity: undefined,
            postageSizeDetails: undefined,
          };
        }
      }),
    );
  }

  private async getProductPage<T extends Product>(
    query: ProductListQuery,
    options: ProductPageOptions = {},
    viewerId?: string,
  ): Promise<PaginatedResult<T>> {
    const requestedCharityId = query.charityId?.trim();
    const normalizedQuery =
      query.charityId !== undefined && requestedCharityId !== query.charityId
        ? { ...query, charityId: requestedCharityId || undefined }
        : query;
    const limit = this.normalizeLimit(normalizedQuery.limit);
    const cursor = this.decodeCursor(
      normalizedQuery.cursor,
      normalizedQuery,
      viewerId,
    );

    let blockedCharityIds: Set<string> | undefined;
    if (viewerId) {
      if (!this.charityBlockRepo) {
        throw new Error('Charity block repository not configured');
      }
      const blockRepo = this.charityBlockRepo;
      if (requestedCharityId) {
        if (await blockRepo.isBlocked(viewerId, requestedCharityId)) {
          return {
            items: [],
            limit,
            nextCursor: null,
            hasMore: false,
          };
        }
      } else {
        blockedCharityIds = await blockRepo.getBlockedCharityIds(viewerId);
      }
    }

    const filterOptions: ProductPageOptions = blockedCharityIds?.size
      ? { ...options, blockedCharityIds }
      : options;

    const items: T[] = [];
    let pageCursor = cursor;
    let scannedPages = 0;
    let scannedProducts = 0;

    do {
      const page = await this.productRepo.getPageByFilters(
        normalizedQuery,
        limit,
        pageCursor,
      );
      scannedPages += 1;
      scannedProducts += page.items.length;

      const matchedItems = this.applyProductFilters(
        this.applySearch(page.items as T[], normalizedQuery.search),
        normalizedQuery,
        filterOptions,
      );
      let hasUnconsumedMatch = false;
      for (const item of matchedItems) {
        if (items.length < limit) {
          items.push(item);
        } else {
          hasUnconsumedMatch = true;
          break;
        }
      }

      if (items.length >= limit) {
        const lastItem = items[items.length - 1];
        const moreAvailable = page.hasMore || hasUnconsumedMatch;
        const lastCursor = page.cursors?.find((cursor) => cursor.id === lastItem.id);
        return {
          items,
          limit,
          nextCursor: moreAvailable
            ? this.encodeCursor(lastItem, normalizedQuery, viewerId, lastCursor)
            : null,
          hasMore: moreAvailable,
        };
      }

      if (!page.items.length || !page.hasMore) {
        break;
      }

      const lastExaminedProduct = page.items[page.items.length - 1];
      const lastCursor = page.cursors?.find(
        (cursor) => cursor.id === lastExaminedProduct.id,
      );
      const continuationCursor = this.encodeCursor(
        lastExaminedProduct,
        normalizedQuery,
        viewerId,
        lastCursor,
      );

      if (
        scannedPages >= MAX_PRODUCT_SCAN_PAGES ||
        scannedProducts >= MAX_PRODUCT_SCAN_ITEMS
      ) {
        return {
          items,
          limit,
          nextCursor: continuationCursor,
          hasMore: true,
        };
      }

      pageCursor = this.decodeCursor(
        continuationCursor,
        normalizedQuery,
        viewerId,
      );
    } while (items.length < limit);

    return {
      items,
      limit,
      nextCursor: null,
      hasMore: false,
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
    options: ProductPageOptions = {},
  ): T[] {
    return products.filter((product) => {
      if (options.availableOnly && !this.isAvailableForPurchase(product)) {
        return false;
      }

      if (!options.includeModerationHidden && this.isModerationHidden(product)) {
        return false;
      }

      if (
        options.blockedCharityIds?.size &&
        typeof product.charityId === 'string' &&
        options.blockedCharityIds.has(product.charityId.trim())
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

      if (query.status && product.status !== query.status) {
        return false;
      }

      if (
        typeof query.minPrice === 'number' &&
        product.price < query.minPrice
      ) {
        return false;
      }

      if (
        typeof query.maxPrice === 'number' &&
        product.price > query.maxPrice
      ) {
        return false;
      }

      return true;
    });
  }

  private isAvailableForPurchase(product: Product): boolean {
    return product.status === 'active' && this.hasStock(product);
  }

  private isModerationHidden(product: Product): boolean {
    const raw = product as unknown as Record<string, unknown>;
    return (
      product.hidden === true ||
      raw.isHidden === true ||
      raw.moderationHidden === true ||
      product.moderationStatus === 'hidden' ||
      (product.hiddenAt !== undefined && product.hiddenAt !== null) ||
      raw.deleted === true ||
      raw.isDeleted === true ||
      raw.removed === true ||
      raw.isRemoved === true ||
      (raw.deletedAt !== undefined && raw.deletedAt !== null) ||
      (raw.removedAt !== undefined && raw.removedAt !== null)
    );
  }

  private hasStock(product: Product): boolean {
    return typeof product.number === 'number' && product.number > 0;
  }

  private statusForStock(number: number): ProductStatus {
    return number > 0 ? 'active' : 'sold';
  }

  private normalizeLimit(limit?: number): number {
    if (!limit || Number.isNaN(limit)) {
      return DEFAULT_PRODUCT_PAGE_SIZE;
    }

    return Math.min(Math.max(limit, 1), MAX_PRODUCT_PAGE_SIZE);
  }

  private encodeCursor(
    product: Product,
    query: ProductListQuery,
    viewerId?: string,
    position?: ProductQueryCursor,
  ): string {
    const timestamp = position?.createdAt;
    return Buffer.from(
      JSON.stringify({
        createdAt: this.requireProductCreatedAt(product).toISOString(),
        ...(timestamp instanceof Timestamp ? {
          createdAtSeconds: timestamp.seconds,
          createdAtNanoseconds: timestamp.nanoseconds,
        } : {}),
        id: product.id,
        signature: this.buildQuerySignature(query, viewerId),
      }),
      'utf8',
    ).toString('base64');
  }

  private decodeCursor(
    cursor: string | undefined,
    query: ProductListQuery,
    viewerId?: string,
  ): ProductQueryCursor | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as {
        createdAt?: string;
        createdAtSeconds?: number;
        createdAtNanoseconds?: number;
        id?: string;
        signature?: string;
      };

      if (
        typeof parsed.createdAt !== 'string' ||
        !parsed.createdAt ||
        typeof parsed.id !== 'string' ||
        !parsed.id ||
        parsed.signature !== this.buildQuerySignature(query, viewerId)
      ) {
        throw new Error('Invalid cursor');
      }

      const parsedDate = new Date(parsed.createdAt);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new Error('Invalid cursor');
      }

      let createdAt: Date | Timestamp = parsedDate;
      if (
        parsed.createdAtSeconds !== undefined ||
        parsed.createdAtNanoseconds !== undefined
      ) {
        if (
          typeof parsed.createdAtSeconds !== 'number' ||
          typeof parsed.createdAtNanoseconds !== 'number' ||
          !Number.isInteger(parsed.createdAtSeconds) ||
          !Number.isInteger(parsed.createdAtNanoseconds)
        ) {
          throw new Error('Invalid cursor');
        }
        createdAt = new Timestamp(
          parsed.createdAtSeconds,
          parsed.createdAtNanoseconds,
        );
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
    return Buffer.from(
      JSON.stringify({
        createdAt: createdAt.toISOString(),
        id,
        signature: this.buildQuerySignature(query),
        type: 'liked',
      }),
      'utf8',
    ).toString('base64');
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
      ) as {
        createdAt?: string;
        id?: string;
        signature?: string;
        type?: string;
      };

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

  private requireProductCreatedAt(product: Product): Date {
    if (
      !(product.createdAt instanceof Date) ||
      Number.isNaN(product.createdAt.getTime())
    ) {
      throw new Error(
        `Product ${product.id || 'unknown'} is missing a valid createdAt value`,
      );
    }

    return product.createdAt;
  }

  private buildQuerySignature(
    query: ProductListQuery,
    viewerId?: string,
  ): string {
    return JSON.stringify({
      search: query.search?.trim().toLowerCase() || '',
      categoryId: query.categoryId || '',
      charityId: query.charityId || '',
      size: query.size || '',
      quality: query.quality || '',
      status: query.status || '',
      minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null,
      viewerId: viewerId || '',
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
  quality?: string;
  size?: string;
  product_images?: string[];
}

export interface ProductListQuery extends ProductListFilters {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: ProductStatus;
}

interface ProductPageOptions {
  availableOnly?: boolean;
  includeModerationHidden?: boolean;
  blockedCharityIds?: Set<string>;
}

export interface PaginatedResult<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}
