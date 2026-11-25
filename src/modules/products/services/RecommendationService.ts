// The recommended feed (issue #57): GET /api/products/recommended.
//
// Page 1 reads the user's likes, purchases and blocks, scores the newest
// products against their taste, and remembers the order. Later pages walk
// through that saved order, so it stays the same until the user refreshes.
// If the saved order is gone, a later page answers "Feed expired", and the
// app starts again from page 1.
import { randomUUID } from 'crypto';
import { Product } from '../model/Product';
import { ProductLikeRepository } from '../repositories/ProductLikeRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { UserBlockRepository } from '../../blocks/repositories/UserBlockRepository';
import { CharityBlockRepository } from '../../blocks/repositories/CharityBlockRepository';
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

// How many feed orders are kept in memory at once. Each page 1 starts a new
// one, so a user on 2 phones has 2. When it's full, the one used longest ago
// is dropped, and its next page answers "Feed expired".
export const MAX_SAVED_FEEDS = 1000;

// Same page sizes as /with-details.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface RecommendedQuery {
  limit?: number;
  cursor?: string;
}

export class RecommendationService {
  // "user id:feed id" -> that feed's sorted product ids, from its page 1.
  // Kept in memory only and never saved. A server restart empties it, and it
  // holds at most MAX_SAVED_FEEDS feeds.
  private feeds = new Map<string, string[]>();

  constructor(
    private productService: ProductService,
    private productLikeRepo: Pick<
      ProductLikeRepository,
      'getLikedProductIds' | 'getLikedProductIdsAmong'
    >,
    private orderRepo: Pick<OrderRepository, 'getPurchasedProductIds'>,
    private blockRepo: Pick<UserBlockRepository, 'getBlockedUserIds'>,
    private charityBlockRepo: Pick<
      CharityBlockRepository,
      'getBlockedCharityIds'
    >,
    private now: () => Date = () => new Date(),
  ) {}

  async getRecommendedPage(
    userId: string,
    query: RecommendedQuery,
  ): Promise<PaginatedResult<ProductWithDetails>> {
    const limit = normaliseLimit(query.limit);

    // No cursor means page 1 or a refresh: sort again, as a new feed with its
    // own id. Later pages walk through that feed's saved order.
    const cursor: Cursor = query.cursor
      ? decodeCursor(query.cursor)
      : { position: 0, feedId: randomUUID() };
    const key = `${userId}:${cursor.feedId}`;
    let feed: string[];
    let products: Product[];
    if (query.cursor) {
      const saved = this.feeds.get(key);
      // The saved order is gone, for example after a server restart. Sorting
      // again could repeat or skip items, so the app starts again from page 1.
      if (!saved) {
        throw new Error('Feed expired');
      }
      feed = saved;
      const pageIds = feed.slice(cursor.position, cursor.position + limit);
      products = await this.loadStillForSale(userId, pageIds);
    } else {
      // buildFeed has only just checked these products, so page 1 uses them
      // as they are instead of reading them again.
      const ranked = await this.buildFeed(userId);
      feed = ranked.map((product) => product.id as string);
      products = ranked.slice(0, limit);
    }
    this.saveFeed(key, feed);

    const items = await this.productService.enrichProductsWithDetails(products);
    const nextPosition = cursor.position + limit;
    const hasMore = nextPosition < feed.length;

    return {
      items,
      limit,
      nextCursor: hasMore ? encodeCursor(nextPosition, cursor.feedId) : null,
      hasMore,
    };
  }

  // A Map keeps the order items were added. Taking this feed out and adding
  // it back moves it to the end, so the first one is always the feed used
  // longest ago, and that's the one dropped when there are too many.
  private saveFeed(key: string, feed: string[]): void {
    this.feeds.delete(key);
    this.feeds.set(key, feed);
    if (this.feeds.size > MAX_SAVED_FEEDS) {
      const [oldest] = this.feeds.keys();
      this.feeds.delete(oldest);
    }
  }

  // Works out the whole feed order for one user, best match first.
  private async buildFeed(userId: string): Promise<Product[]> {
    // These 4 reads don't depend on each other, so they run at the same time.
    const [likedIds, boughtIds, blockedUserIds, candidates] = await Promise.all(
      [
        this.productLikeRepo.getLikedProductIds(userId),
        this.orderRepo.getPurchasedProductIds(userId),
        this.blockRepo.getBlockedUserIds(userId),
        // Already leaves out charities this user blocked.
        this.productService.getNewestAvailableProducts(MAX_CANDIDATES, userId),
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

    return rankProducts(allowed, profile, this.now());
  }

  // Loads products by id, keeping their order and skipping deleted ones.
  private async loadProducts(ids: string[]): Promise<Product[]> {
    const products = await Promise.all(
      ids.map((id) => this.productService.getProductById(id)),
    );
    return products.filter((product): product is Product => product !== null);
  }

  // Something on a later page may have sold or been hidden since page 1, or
  // the user may have blocked its seller or charity, liked it or bought it
  // since then.
  private async loadStillForSale(
    userId: string,
    ids: string[],
  ): Promise<Product[]> {
    const [products, blockedUserIds, blockedCharityIds, likedIds, boughtIds] =
      await Promise.all([
        this.loadProducts(ids),
        this.blockRepo.getBlockedUserIds(userId),
        this.charityBlockRepo.getBlockedCharityIds(userId),
        this.productLikeRepo.getLikedProductIdsAmong(userId, ids),
        this.orderRepo.getPurchasedProductIds(userId),
      ]);
    const likedOrBought = new Set([...likedIds, ...boughtIds]);
    return products.filter(
      (product) =>
        this.productService.isAvailableForPurchase(product) &&
        !this.productService.isModerationHidden(product) &&
        !blockedUserIds.has(product.userId) &&
        !this.productService.isFromBlockedCharity(product, blockedCharityIds) &&
        !likedOrBought.has(product.id as string),
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

// The cursor is a bookmark: { "position": 20, "feedId": "1b9d6bcd-..." }
// written in base64, the same style as the /with-details cursor. The app
// passes it back unread. feedId says which saved order it belongs to.
export interface Cursor {
  position: number;
  feedId: string;
}

// The shape of the ids randomUUID makes. Checking it means a feed id can't
// contain the ":" used in the saved orders' "user id:feed id" keys.
const FEED_ID = /^[0-9a-f-]{36}$/;

export function encodeCursor(position: number, feedId: string): string {
  return Buffer.from(JSON.stringify({ position, feedId }), 'utf8').toString(
    'base64',
  );
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (
      Number.isInteger(parsed?.position) &&
      parsed.position >= 0 &&
      typeof parsed.feedId === 'string' &&
      FEED_ID.test(parsed.feedId)
    ) {
      return { position: parsed.position, feedId: parsed.feedId };
    }
  } catch {
    // Not base64 JSON: handled below.
  }
  throw new Error('Invalid cursor');
}
