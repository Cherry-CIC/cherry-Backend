import { Product } from '../model/Product';
import {
  buildTasteProfile,
  LIKE_DECAY,
  isColdStart,
  MIX_EVERY,
  rankProducts,
  scoreProduct,
  titleWords,
} from '../services/recommendationScoring';

// A listing with sensible defaults. Each test only sets what it cares about.
const makeProduct = (overrides: Partial<Product>): Product => ({
  id: 'product',
  name: 'Item',
  categoryId: 'cat-men',
  charityId: 'charity-animals',
  userId: 'seller-a',
  quality: 'GOOD',
  size: 'Medium',
  product_images: [],
  donation: 5,
  price: 5,
  likes: 0,
  number: 1,
  status: 'active',
  ...overrides,
});

// The Shirt buyer from the seed: 3 likes and 1 purchase.
const shirtBuyer = buildTasteProfile(
  [
    makeProduct({ name: 'Mens shirt', price: 4 }),
    makeProduct({
      name: 'Next blue denim shirt - Large',
      size: 'Large',
      quality: 'EXCELLENT',
      charityId: 'charity-books',
      userId: 'seller-b',
      price: 6,
    }),
    makeProduct({ name: "Men's white Oxford shirt, regular fit", price: 5 }),
  ],
  [
    makeProduct({
      name: 'Checked flannel shirt M',
      charityId: 'charity-books',
      userId: 'seller-b',
      price: 5,
    }),
  ],
  'shirt-buyer',
);

describe('titleWords', () => {
  it('keeps the words that say what the item is', () => {
    expect(titleWords("BNWT Men's checked shirt M slim fit")).toEqual([
      'checked',
      'shirt',
      'slim',
      'fit',
    ]);
  });

  it('turns plurals into singular', () => {
    expect(titleWords('shirts dresses shoes boxes')).toEqual([
      'shirt',
      'dress',
      'shoe',
      'box',
    ]);
  });
});

// How much each of the Shirt buyer's likes and their purchase count. Likes are
// newest first: 1, then LIKE_DECAY, then LIKE_DECAY squared (with 0.95 that's
// 1, 0.95 and 0.9025). The purchase counts 3.
const mensShirtLike = 1;
const denimShirtLike = LIKE_DECAY;
const oxfordShirtLike = LIKE_DECAY ** 2;
const flannelPurchase = 3;
// All four are men's: 5.85 with 0.95.
const total =
  mensShirtLike + denimShirtLike + oxfordShirtLike + flannelPurchase;
// Medium and GOOD (everything except the denim shirt): 4.90 with 0.95.
const mediumAndGood = mensShirtLike + oxfordShirtLike + flannelPurchase;
// Seller A and the animal charity: 1.90 with 0.95.
const sellerA = mensShirtLike + oxfordShirtLike;
// Seller B and the books charity: 3.95 with 0.95.
const sellerB = denimShirtLike + flannelPurchase;

describe('buildTasteProfile', () => {
  it('counts newer likes more, and a purchase as 3', () => {
    expect(shirtBuyer.categories.get('cat-men')).toBeCloseTo(total);
    expect(shirtBuyer.sizes.get('medium')).toBeCloseTo(mediumAndGood);
    expect(shirtBuyer.sizes.get('large')).toBeCloseTo(denimShirtLike);
    expect(shirtBuyer.sellers.get('seller-b')).toBeCloseTo(sellerB);
  });
});

describe('scoreProduct', () => {
  const now = new Date('2026-10-21T12:00:00Z');

  // p03 and p08 from the seed, listed long ago so there is no recency bonus.
  const checkedShirt = makeProduct({
    name: "BNWT Men's checked shirt M slim fit",
    quality: 'NEW',
    price: 9,
  });
  const ladiesDress = makeProduct({
    name: 'Ladies dress size 14',
    categoryId: 'cat-women',
    size: 'Large',
    charityId: 'charity-books',
    price: 3,
  });

  it("scores a men's Medium shirt well above a women's dress", () => {
    // Men (3) + Medium + 3 shared words (checked, shirt, fit: 6, capped at 3)
    // + the animal charity + seller A + price, about 8. Its quality doesn't
    // match.
    expect(scoreProduct(checkedShirt, shirtBuyer, now)).toBeCloseTo(
      3 +
        1 * (mediumAndGood / total) +
        3 +
        0.25 * (sellerA / total) +
        0.25 * (sellerA / total) +
        1,
    );
    // Large + GOOD + the books charity + seller A + price, about 2.3.
    expect(scoreProduct(ladiesDress, shirtBuyer, now)).toBeCloseTo(
      1 * (denimShirtLike / total) +
        mediumAndGood / total +
        0.25 * (sellerB / total) +
        0.25 * (sellerA / total) +
        1,
    );
  });

  it('ranks another dress above boots in the same size after liking a dress', () => {
    // The boots match the liked dress on size, seller and charity. The other
    // dress only matches on what it is, and that must count for more.
    const likedDress = buildTasteProfile([ladiesDress], [], 'newbie');
    const boots = { ...ladiesDress, name: 'Black chelsea boots 7', price: 10 };
    const otherDress = {
      ...ladiesDress,
      name: 'Navy blue dress, size 12',
      size: 'Medium',
      userId: 'seller-d',
      price: 9,
    };
    expect(scoreProduct(otherDress, likedDress, now)).toBeGreaterThan(
      scoreProduct(boots, likedDress, now),
    );
  });
});

describe('rankProducts', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000);
  const ids = (products: Product[]) => products.map((product) => product.id);

  // 10 men's shirts (the Shirt buyer's taste), shirt-1 the newest,
  // and 2 older women's dresses (outside their taste).
  const shirts = Array.from({ length: 10 }, (_, index) =>
    makeProduct({
      id: `shirt-${index + 1}`,
      name: 'Mens shirt',
      createdAt: hoursAgo(index + 1),
    }),
  );
  const dresses = [
    makeProduct({
      id: 'dress-old',
      name: 'Ladies dress',
      categoryId: 'cat-women',
      createdAt: hoursAgo(50),
    }),
    makeProduct({
      id: 'dress-new',
      name: 'Ladies dress',
      categoryId: 'cat-women',
      createdAt: hoursAgo(40),
    }),
  ];
  const candidates = [...dresses, ...shirts];

  it('puts the best matches first, newest first when they tie', () => {
    const ranked = rankProducts(candidates, shirtBuyer, now);
    expect(ids(ranked.slice(0, 4))).toEqual([
      'shirt-1',
      'shirt-2',
      'shirt-3',
      'shirt-4',
    ]);
  });

  it(`gives every ${MIX_EVERY}th slot to something outside their taste`, () => {
    const ranked = rankProducts(candidates, shirtBuyer, now);
    expect(ranked[4].id).toBe('dress-new'); // slot 5: newest one first
    expect(ranked[9].id).toBe('dress-old'); // slot 10
  });

  it('gives a new user plain newest first, with no mixing', () => {
    const newbie = buildTasteProfile([], [], 'newbie');
    expect(isColdStart(newbie)).toBe(true);
    expect(isColdStart(shirtBuyer)).toBe(false);
    expect(ids(rankProducts(candidates, newbie, now))).toEqual([
      ...ids(shirts),
      'dress-new',
      'dress-old',
    ]);
  });
});

describe('rankProducts with gifts', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000);
  const many = (count: number, prefix: string, overrides: Partial<Product>) =>
    Array.from({ length: count }, (_, index) =>
      makeProduct({
        id: `${prefix}-${index + 1}`,
        createdAt: hoursAgo(index + 1),
        ...overrides,
      }),
    );
  const countIn = (products: Product[], categoryId: string) =>
    products.filter((product) => product.categoryId === categoryId).length;
  const shirt = { name: 'Mens shirt', categoryId: 'cat-men' };
  const dress = { name: 'Ladies dress', categoryId: 'cat-women' };

  it('gives each gift kind its own 2 in 10, keeping 6 for the main taste', () => {
    // A dress buyer who bought a shirt for a partner and a jumper for a child.
    const profile = buildTasteProfile(
      many(3, 'liked', dress),
      [
        makeProduct({ id: 'bought-dress', ...dress }),
        makeProduct({ id: 'bought-shirt', ...shirt }),
        makeProduct({
          id: 'bought-jumper',
          name: 'Baby jumper',
          categoryId: 'cat-kids',
        }),
      ],
      'dress-buyer',
    );
    const candidates = [
      ...many(10, 'dress', dress),
      ...many(5, 'shirt', shirt),
      ...many(5, 'kids', { name: 'Kids top', categoryId: 'cat-kids' }),
    ];

    const top10 = rankProducts(candidates, profile, now).slice(0, 10);

    expect([
      countIn(top10, 'cat-women'),
      countIn(top10, 'cat-men'),
      countIn(top10, 'cat-kids'),
    ]).toEqual([6, 2, 2]);
  });
});
