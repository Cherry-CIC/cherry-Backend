import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';
import { exposedListing } from '../../../shared/utils/listingSafety';
import { gbpToPence } from '../../../shared/utils/money';
import { CharityBlockRepository } from '../../blocks/repositories/CharityBlockRepository';
import { Category } from '../../categories/model/Category';
import { CategoryRepository } from '../../categories/repositories/CategoryRepository';
import { PostageSize } from '../../postage-sizes/model/PostageSize';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { Product } from '../../products/model/Product';
import {
  CharityProductPosition,
  ProductRepository,
} from '../../products/repositories/ProductRepository';
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
const SCAN_CHUNK_SIZE = 100;
const MAX_SCANNED_PRODUCTS = 5000;
const MIN_TIMESTAMP_SECONDS = -62135596800;
const MAX_TIMESTAMP_SECONDS = 253402300799;

const isValidDocumentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.trim() === value &&
  value !== '.' &&
  value !== '..' &&
  !/[/\\\x00-\x1f\x7f-\x9f]/.test(value) &&
  Buffer.byteLength(value, 'utf8') <= 1500;

const isDisplayableListing = (product: Product, charityId: string): boolean => {
  if (product.charityId !== charityId) return false;
  if (product.status !== 'active') return false;
  if (!Number.isSafeInteger(product.number) || product.number <= 0) {
    return false;
  }
  const raw = product as unknown as Record<string, unknown>;
  if (
    product.hidden === true ||
    raw.isHidden === true ||
    raw.moderationHidden === true ||
    product.moderationStatus === 'hidden' ||
    (product.hiddenAt !== undefined && product.hiddenAt !== null)
  ) {
    return false;
  }
  if (
    raw.deleted === true ||
    raw.isDeleted === true ||
    raw.removed === true ||
    raw.isRemoved === true ||
    (raw.deletedAt !== undefined && raw.deletedAt !== null) ||
    (raw.removedAt !== undefined && raw.removedAt !== null)
  ) {
    return false;
  }
  return true;
};

const encodeCursor = (
  charityId: string,
  viewerId: string,
  position: CharityProductPosition,
): string =>
  Buffer.from(
    JSON.stringify({
      v: 2,
      charityId,
      viewerId,
      seconds: position.seconds,
      nanoseconds: position.nanoseconds,
      lastId: position.id,
    }),
    'utf8',
  ).toString('base64url');

const decodeCursor = (
  cursor: string,
  charityId: string,
  viewerId: string,
): CharityProductPosition => {
  try {
    if (!cursor || cursor.length > 4096) {
      throw new InvalidCharityProductCursor();
    }
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) {
      throw new InvalidCharityProductCursor();
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as {
      v?: unknown;
      charityId?: unknown;
      viewerId?: unknown;
      seconds?: unknown;
      nanoseconds?: unknown;
      lastId?: unknown;
    };
    if (
      !parsed ||
      parsed.v !== 2 ||
      parsed.charityId !== charityId ||
      parsed.viewerId !== viewerId ||
      !Number.isInteger(parsed.seconds) ||
      (parsed.seconds as number) < MIN_TIMESTAMP_SECONDS ||
      (parsed.seconds as number) > MAX_TIMESTAMP_SECONDS ||
      !Number.isInteger(parsed.nanoseconds) ||
      (parsed.nanoseconds as number) < 0 ||
      (parsed.nanoseconds as number) >= 1_000_000_000 ||
      !isValidDocumentId(parsed.lastId)
    ) {
      throw new InvalidCharityProductCursor();
    }
    return {
      seconds: parsed.seconds as number,
      nanoseconds: parsed.nanoseconds as number,
      id: parsed.lastId,
    };
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
      'getCharityProductBatch'
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
    const afterPosition = query.cursor
      ? decodeCursor(query.cursor, charityId, viewerId)
      : undefined;

    if (await this.blocks.isBlocked(viewerId, charityId)) {
      return {
        data: { products: [] },
        meta: { limit, nextCursor: null, hasMore: false },
      };
    }

    const charity = await this.charities.getById(charityId);
    if (!charity) return null;

    const eligible: { product: Product; position: CharityProductPosition }[] =
      [];
    let scanned = 0;
    let exhausted = false;
    let batchSize = limit + 1;
    let scanAfter:
      | CharityProductPosition
      | FirebaseFirestore.QueryDocumentSnapshot
      | undefined = afterPosition;

    while (eligible.length < limit + 1 && !exhausted) {
      const sourceLimit = Math.min(batchSize, MAX_SCANNED_PRODUCTS - scanned);
      if (sourceLimit === 0) {
        throw new Error('Charity product scan limit exceeded');
      }

      const batch = await this.products.getCharityProductBatch(
        charityId,
        sourceLimit,
        scanAfter,
      );
      scanned += batch.items.length;
      exhausted = batch.exhausted || !batch.nextScanAfter;

      for (const item of batch.items) {
        if (!item.position) continue;
        if (!isDisplayableListing(item.product, charityId)) continue;
        eligible.push({ product: item.product, position: item.position });
        if (eligible.length === limit + 1) break;
      }

      if (!exhausted && eligible.length < limit + 1) {
        scanAfter = batch.nextScanAfter;
        batchSize = SCAN_CHUNK_SIZE;
      }
    }

    const pageEntries = eligible.slice(0, limit);
    const slice = pageEntries.map((entry) => entry.product);
    const hasMore = eligible.length > limit;
    const nextCursor =
      hasMore && pageEntries.length > 0
        ? encodeCursor(
            charityId,
            viewerId,
            pageEntries[pageEntries.length - 1].position,
          )
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
