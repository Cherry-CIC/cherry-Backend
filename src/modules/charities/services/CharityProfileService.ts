import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';
import { exposedListing } from '../../../shared/utils/listingSafety';
import { gbpToPence } from '../../../shared/utils/money';
import { CharityBlockRepository } from '../../blocks/repositories/CharityBlockRepository';
import { Category } from '../../categories/model/Category';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { PostageSize } from '../../postage-sizes/model/PostageSize';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { Product } from '../../products/model/Product';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { Charity } from '../model/Charity';
import { CharityRepository } from '../repositories/CharityRepository';

export class InvalidCharityProductCursor extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCharityProductCursor';
  }
}

export interface CharityProductsQuery {
  limit?: number;
  cursor?: string;
}

export interface CharityProductWithDetails extends Product {
  securityFee: number;
  category?: Category;
  charity?: Charity;
  postageSizeDetails?: PostageSize;
}

export interface CharityProductsPage {
  data: { products: CharityProductWithDetails[] };
  meta: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const isDisplayableListing = (product: Product, charityId: string): boolean => {
  if (product.charityId !== charityId) return false;
  if (product.status !== 'active') return false;
  if (typeof product.number !== 'number' || product.number <= 0) return false;
  if (
    product.hidden === true ||
    product.moderationStatus === 'hidden' ||
    (product.hiddenAt !== undefined && product.hiddenAt !== null)
  ) {
    return false;
  }
  const raw = product as unknown as Record<string, unknown>;
  if (
    raw.deleted === true ||
    raw.isDeleted === true ||
    raw.removed === true ||
    raw.isRemoved === true
  ) {
    return false;
  }
  return true;
};

const encodeCursor = (charityId: string, viewerId: string, lastId: string): string =>
  Buffer.from(
    JSON.stringify({ v: 1, charityId, viewerId, lastId }),
    'utf8',
  ).toString('base64url');

const decodeCursor = (
  cursor: string,
  charityId: string,
  viewerId: string,
): string => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { v?: unknown; charityId?: unknown; viewerId?: unknown; lastId?: unknown };
    if (
      parsed.v !== 1 ||
      parsed.charityId !== charityId ||
      parsed.viewerId !== viewerId ||
      typeof parsed.lastId !== 'string' ||
      !parsed.lastId
    ) {
      throw new InvalidCharityProductCursor();
    }
    return parsed.lastId;
  } catch {
    throw new InvalidCharityProductCursor();
  }
};

/** Serves active listings associated with a charity while respecting viewer blocks. */
export class CharityProfileService {
  constructor(
    private readonly charities: Pick<
      CharityRepository,
      'getById'
    > = new CharityRepository(),
    private readonly products: Pick<
      ProductRepository,
      'getProductsByCharity'
    > = new ProductRepository(),
    private readonly categories: Pick<
      CategoryRepository,
      'getById'
    > = new CategoryRepository(),
    private readonly postageSizes: Pick<
      PostageSizeRepository,
      'getById'
    > = new PostageSizeRepository(),
    private readonly blocks: Pick<
      CharityBlockRepository,
      'isBlocked'
    > = new CharityBlockRepository(),
  ) {}

  async getCharityProducts(
    charityId: string,
    viewerId: string,
    query: CharityProductsQuery = {},
  ): Promise<CharityProductsPage | null> {
    const limit = Math.min(
      Math.max(Number.isInteger(query.limit) ? query.limit! : DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const afterId = query.cursor
      ? decodeCursor(query.cursor, charityId, viewerId)
      : null;

    if (await this.blocks.isBlocked(viewerId, charityId)) {
      return {
        data: { products: [] },
        meta: { limit, nextCursor: null, hasMore: false },
      };
    }

    const charity = await this.charities.getById(charityId);
    if (!charity) return null;

    const rawProducts = await this.products.getProductsByCharity(charityId);
    const activeSorted = rawProducts
      .filter((product) => isDisplayableListing(product, charityId))
      .sort((a, b) => {
        const timeDiff = toMillis(b.createdAt) - toMillis(a.createdAt);
        return timeDiff !== 0 ? timeDiff : (b.id || '').localeCompare(a.id || '');
      });

    let startIndex = 0;
    if (afterId !== null) {
      const idx = activeSorted.findIndex((item) => item.id === afterId);
      if (idx === -1) {
        return {
          data: { products: [] },
          meta: { limit, nextCursor: null, hasMore: false },
        };
      }
      startIndex = idx + 1;
    }

    const slice = activeSorted.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < activeSorted.length;
    const nextCursor =
      hasMore && slice.length > 0 && slice[slice.length - 1].id
        ? encodeCursor(charityId, viewerId, slice[slice.length - 1].id!)
        : null;

    const categoryCache = new Map<string, Promise<Category | null>>();
    const postageCache = new Map<string, Promise<PostageSize | null>>();

    const products = await Promise.all(
      slice.map(async (product) => {
        const categoryId = product.categoryId?.trim();
        let categoryPromise: Promise<Category | null> = Promise.resolve(null);
        if (categoryId) {
          if (!categoryCache.has(categoryId)) {
            categoryCache.set(
              categoryId,
              this.categories.getById(categoryId).catch(() => null),
            );
          }
          categoryPromise = categoryCache.get(categoryId)!;
        }

        const postageId = product.postageSize?.trim();
        let postagePromise: Promise<PostageSize | null> = Promise.resolve(null);
        if (postageId) {
          if (!postageCache.has(postageId)) {
            postageCache.set(
              postageId,
              this.postageSizes.getById(postageId).catch(() => null),
            );
          }
          postagePromise = postageCache.get(postageId)!;
        }

        const [category, postageSizeDetails] = await Promise.all([
          categoryPromise,
          postagePromise,
        ]);

        return {
          ...exposedListing(product),
          securityFee:
            calculateSecurityFeePence(gbpToPence(product.price)) / 100,
          charity,
          category: category || undefined,
          postageSizeDetails: postageSizeDetails || undefined,
        } as CharityProductWithDetails;
      }),
    );

    return {
      data: { products },
      meta: { limit, nextCursor, hasMore },
    };
  }
}
