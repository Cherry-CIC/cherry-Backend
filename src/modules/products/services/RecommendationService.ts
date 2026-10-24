// The recommended feed (issue #57): GET /api/products/recommended.
//
// Page 1 reads the user's likes, purchases and blocks, scores the newest
// products against their taste, and remembers the order. Later pages walk
// through that saved order, so it stays the same until the user refreshes.
import { Product } from '../model/Product';
import { ProductLikeRepository } from '../repositories/ProductLikeRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { UserBlockRepository } from '../../blocks/repositories/UserBlockRepository';
import {
  PaginatedResult,
  ProductService,
  ProductWithDetails,
} from './ProductService';
import { buildTasteProfile, rankProducts } from './recommendationScoring';

// How many of the newest products are considered for one feed.
export const MAX_CANDIDATES = 200;

// How many of the newest likes build the taste. Each older like counts a
// little less, so likes past 100 add up to under 1% of it. Skipping them
// saves one product read per like.
export const MAX_PROFILE_LIKES = 100;

// How many users' feed orders are kept in memory at once. When it's full,
// the one used longest ago is dropped, and their next page sorts again.
export const MAX_SAVED_FEEDS = 1000;

// Same page sizes as /with-details.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface RecommendedQuery {
  limit?: number;
  cursor?: string;
}

export class RecommendationService {
  // user id -> that user's sorted product ids, from their last page 1.
  // Kept in memory only and never saved. A refresh replaces it, a server
  // restart empties it, and it holds at most MAX_SAVED_FEEDS users.
  private feeds = new Map<string, string[]>();

  constructor(
    private productService: ProductService,
    private productLikeRepo: Pick<ProductLikeRepository, 'getLikedProductIds'>,
    private orderRepo: Pick<OrderRepository, 'getPurchasedProductIds'>,
    private blockRepo: Pick<UserBlockRepository, 'getBlockedUserIds'>,
    private now: () => Date = () => new Date(),
  ) {}

  async getRecommendedPage(
    userId: string,
    query: RecommendedQuery,
  ): Promise<PaginatedResult<ProductWithDetails>> {
    const limit = normaliseLimit(query.limit);
    const position = query.cursor ? decodeCursor(query.cursor) : 0;

    // No cursor means page 1 or a refresh: sort again. Later pages reuse the
    // saved order, unless it's missing (for example after a server restart).
    let feed = query.cursor ? this.feeds.get(userId) : undefined;
    if (!feed) {
      feed = await this.buildFeed(userId);
    }
    this.saveFeed(userId, feed);

    const pageIds = feed.slice(position, position + limit);
    const products = await this.loadStillForSale(userId, pageIds);
    const items = await this.productService.enrichProductsWithDetails(products);
    const nextPosition = position + limit;
    const hasMore = nextPosition < feed.length;

    return {
      items,
      limit,
      nextCursor: hasMore ? encodeCursor(nextPosition) : null,
      hasMore,
    };
  }

  // A Map keeps the order items were added. Taking this user out and adding
  // them back moves them to the end, so the first one is always the user
  // served longest ago, and that's the one dropped when there are too many.
  private saveFeed(userId: string, feed: string[]): void {
    this.feeds.delete(userId);
    this.feeds.set(userId, feed);
    if (this.feeds.size > MAX_SAVED_FEEDS) {
      const [oldest] = this.feeds.keys();
      this.feeds.delete(oldest);
    }
  }

  // Works out the whole feed order for one user, as a list of product ids.
  private async buildFeed(userId: string): Promise<string[]> {
    // These 4 reads don't depend on each other, so they run at the same time.
    const [likedIds, boughtIds, blockedUserIds, candidates] = await Promise.all(
      [
        this.productLikeRepo.getLikedProductIds(userId),
        this.orderRepo.getPurchasedProductIds(userId),
        this.blockRepo.getBlockedUserIds(userId),
        this.productService.getNewestAvailableProducts(MAX_CANDIDATES),
      ],
    );

    // likedIds come newest first, and loadProducts keeps that order, which
    // buildTasteProfile needs so newer likes count more. Every like is still
    // left out of the feed below, not just these.
    const [liked, bought] = await Promise.all([
      this.loadProducts(likedIds.slice(0, MAX_PROFILE_LIKES)),
      this.loadProducts(boughtIds),
    ]);
    const profile = buildTasteProfile(liked, bought, userId);

    const alreadyLikedOrBought = new Set([...likedIds, ...boughtIds]);
    const allowed = candidates.filter(
      (product) =>
        product.id !== undefined &&
        product.userId !== userId && // their own listing
        !alreadyLikedOrBought.has(product.id) &&
        !blockedUserIds.has(product.userId), // a seller they blocked
    );

    return rankProducts(allowed, profile, this.now()).map(
      (product) => product.id as string,
    );
  }

  // Loads products by id, keeping their order and skipping deleted ones.
  private async loadProducts(ids: string[]): Promise<Product[]> {
    const products = await Promise.all(
      ids.map((id) => this.productService.getProductById(id)),
    );
    return products.filter((product): product is Product => product !== null);
  }

  // Something on a later page may have sold or been hidden since page 1, or
  // the user may have blocked its seller since then.
  private async loadStillForSale(
    userId: string,
    ids: string[],
  ): Promise<Product[]> {
    const [products, blockedUserIds] = await Promise.all([
      this.loadProducts(ids),
      this.blockRepo.getBlockedUserIds(userId),
    ]);
    return products.filter(
      (product) =>
        this.productService.isAvailableForPurchase(product) &&
        !this.productService.isModerationHidden(product) &&
        !blockedUserIds.has(product.userId),
    );
  }
}

function normaliseLimit(limit: number | undefined): number {
  const value = Number(limit);
  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

// The cursor is a bookmark: { "position": 20 } written in base64, the same
// style as the /with-details cursor. The app passes it back unread.
export function encodeCursor(position: number): string {
  return Buffer.from(JSON.stringify({ position }), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (Number.isInteger(parsed?.position) && parsed.position >= 0) {
      return parsed.position;
    }
  } catch {
    // Not base64 JSON: handled below.
  }
  throw new Error('Invalid cursor');
}
