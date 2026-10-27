import { randomUUID } from 'crypto';
import { Product } from '../model/Product';
import { ProductService } from '../services/ProductService';
import {
  decodeCursor,
  encodeCursor,
  MAX_PROFILE_LIKES,
  MAX_SAVED_FEEDS,
  RecommendationService,
} from '../services/RecommendationService';

const now = new Date('2026-10-21T12:00:00Z');
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);

const makeProduct = (
  id: string,
  overrides: Partial<Product> = {},
): Product => ({
  id,
  name: 'Mens shirt',
  categoryId: 'cat-men',
  charityId: 'charity-1',
  userId: 'seller-a',
  quality: 'GOOD',
  size: 'Medium',
  product_images: [],
  donation: 5,
  price: 5,
  likes: 0,
  number: 1,
  status: 'active',
  createdAt: hoursAgo(1),
  ...overrides,
});

const ids = (items: Product[]) => items.map((item) => item.id);

// A small fake shop. `store` plays the part of Firestore's products, and the
// likes, orders and blocks are plain lists.
const setUp = (
  products: Product[],
  options: { liked?: string[]; bought?: string[]; blocked?: string[] } = {},
) => {
  const store = new Map(products.map((product) => [product.id!, product]));
  const liked = options.liked ?? [];
  const isForSale = (product: Product) =>
    product.status === 'active' && product.number > 0;

  const productService = {
    getNewestAvailableProducts: jest.fn(async () =>
      [...store.values()]
        .filter((product) => isForSale(product) && !product.hidden)
        .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime()),
    ),
    getProductById: jest.fn(async (id: string) => store.get(id) ?? null),
    enrichProductsWithDetails: jest.fn(async (items: Product[]) => items),
    isAvailableForPurchase: isForSale,
    isModerationHidden: (product: Product) => product.hidden === true,
  };

  const service = new RecommendationService(
    productService as unknown as ProductService,
    { getLikedProductIds: jest.fn(async () => [...liked]) },
    { getPurchasedProductIds: jest.fn(async () => options.bought ?? []) },
    { getBlockedUserIds: jest.fn(async () => new Set(options.blocked)) },
    () => now,
  );
  return { service, store, liked, productService };
};

// 25 products, p1 the newest.
const shop = () =>
  Array.from({ length: 25 }, (_, index) =>
    makeProduct(`p${index + 1}`, { createdAt: hoursAgo(index + 1) }),
  );

describe('RecommendationService', () => {
  it('never shows their own, liked, bought or blocked items', async () => {
    const { service } = setUp(
      [
        makeProduct('mine', { userId: 'buyer' }),
        makeProduct('liked'),
        makeProduct('bought'),
        makeProduct('blocked', { userId: 'blocked-seller' }),
        makeProduct('ok-1'),
        makeProduct('ok-2'),
      ],
      { liked: ['liked'], bought: ['bought'], blocked: ['blocked-seller'] },
    );

    const page = await service.getRecommendedPage('buyer', { limit: 50 });

    expect(ids(page.items).sort()).toEqual(['ok-1', 'ok-2']);
  });

  it('builds the taste from the newest 100 likes, but hides every like', async () => {
    // 120 likes, newest first, plus 2 items they haven't liked.
    const likedIds = Array.from(
      { length: MAX_PROFILE_LIKES + 20 },
      (_, index) => `liked-${index + 1}`,
    );
    const { service, productService } = setUp(
      [
        ...likedIds.map((id) => makeProduct(id)),
        makeProduct('ok-1'),
        makeProduct('ok-2'),
      ],
      { liked: likedIds },
    );

    const page = await service.getRecommendedPage('buyer', { limit: 50 });

    expect(ids(page.items).sort()).toEqual(['ok-1', 'ok-2']);
    const loaded = productService.getProductById.mock.calls.map(([id]) => id);
    expect(loaded).toContain('liked-100');
    expect(loaded).not.toContain('liked-101');
  });

  it('pages through the saved order with no duplicates', async () => {
    const { service, productService } = setUp(shop());

    const pageOne = await service.getRecommendedPage('newbie', { limit: 20 });
    expect(pageOne.items).toHaveLength(20);
    expect(pageOne.hasMore).toBe(true);
    expect(decodeCursor(pageOne.nextCursor!)).toEqual({
      position: 20,
      feedId: expect.any(String),
    });

    const pageTwo = await service.getRecommendedPage('newbie', {
      limit: 20,
      cursor: pageOne.nextCursor!,
    });
    expect(ids(pageTwo.items)).toEqual(['p21', 'p22', 'p23', 'p24', 'p25']);
    expect(pageTwo.hasMore).toBe(false);
    expect(pageTwo.nextCursor).toBeNull();

    const all = [...ids(pageOne.items), ...ids(pageTwo.items)];
    expect(new Set(all).size).toBe(25);
    // Page 2 reused the saved order instead of sorting again.
    expect(productService.getNewestAvailableProducts).toHaveBeenCalledTimes(1);
  });

  it('drops an item that sold, or whose seller was blocked, after page 1', async () => {
    const blocked: string[] = [];
    const { service, store } = setUp(shop(), { blocked });
    store.set('p24', { ...store.get('p24')!, userId: 'rude-seller' });
    const pageOne = await service.getRecommendedPage('newbie', { limit: 20 });

    store.set('p22', { ...store.get('p22')!, status: 'sold', number: 0 });
    blocked.push('rude-seller');

    const pageTwo = await service.getRecommendedPage('newbie', {
      limit: 20,
      cursor: pageOne.nextCursor!,
    });
    expect(ids(pageTwo.items)).toEqual(['p21', 'p23', 'p25']);
  });

  it('says the feed expired when its saved order is gone', async () => {
    // For example after a server restart: page 2 arrives with no page 1.
    const { service, productService } = setUp(shop());

    await expect(
      service.getRecommendedPage('newbie', {
        limit: 20,
        cursor: encodeCursor(20, randomUUID()),
      }),
    ).rejects.toThrow('Feed expired');
    // It didn't sort again, which could repeat or skip items.
    expect(productService.getNewestAvailableProducts).not.toHaveBeenCalled();
  });

  it('keeps a separate order for each phone', async () => {
    const { service, store } = setUp(shop());
    const phone = await service.getRecommendedPage('newbie', { limit: 20 });

    // A new listing arrives, then the same user opens Home on a tablet. The
    // tablet's order starts with the new item, so it's 1 behind the phone's.
    store.set('new', makeProduct('new', { createdAt: now }));
    await service.getRecommendedPage('newbie', { limit: 20 });

    const phoneNext = await service.getRecommendedPage('newbie', {
      limit: 20,
      cursor: phone.nextCursor!,
    });
    expect(ids(phoneNext.items)).toEqual(['p21', 'p22', 'p23', 'p24', 'p25']);
  });

  it("doesn't let a user page through someone else's feed", async () => {
    const { service } = setUp(shop());
    const theirs = await service.getRecommendedPage('newbie', { limit: 20 });

    await expect(
      service.getRecommendedPage('someone-else', {
        limit: 20,
        cursor: theirs.nextCursor!,
      }),
    ).rejects.toThrow('Feed expired');
  });

  it('drops the feed used longest ago when too many are saved', async () => {
    const { service } = setUp(shop());
    const pageOne = await service.getRecommendedPage('first', { limit: 20 });

    // 1,000 more users push 'first' out of the saved orders.
    for (let user = 1; user <= MAX_SAVED_FEEDS; user++) {
      await service.getRecommendedPage(`user-${user}`, { limit: 20 });
    }

    // Their feed was dropped, so page 2 says it expired.
    await expect(
      service.getRecommendedPage('first', {
        limit: 20,
        cursor: pageOne.nextCursor!,
      }),
    ).rejects.toThrow('Feed expired');
  });

  it('rejects a broken cursor', async () => {
    const { service } = setUp(shop());
    const base64 = (text: string) => Buffer.from(text).toString('base64');
    const broken = [
      'not a cursor',
      encodeCursor(-1, randomUUID()),
      base64('{"position":"x"}'),
      base64('{"position":20}'), // no feed id
      encodeCursor(20, 'someone:else'), // not a feed id we made
    ];

    for (const cursor of broken) {
      await expect(
        service.getRecommendedPage('newbie', { cursor }),
      ).rejects.toThrow('Invalid cursor');
    }
  });
});
