// Pure helpers for the recommended feed (issue #57).
//
// "Pure" means the same input always gives the same output, and nothing here
// reads from or writes to Firestore. That keeps every function easy to test.
import { Product } from '../model/Product';

// Words that say nothing about WHAT an item is. Who it is for, its size and
// its condition already have their own fields, so those words are skipped too.
// (prettier-ignore keeps the words grouped, instead of one word per line.)
// prettier-ignore
const STOP_WORDS = new Set([
  // everyday words
  'and', 'the', 'for', 'with', 'from', 'very', 'only', 'set',
  // who it is for (the category says this)
  'men', 'mens', 'man', 'women', 'womens', 'woman', 'ladies', 'lady',
  'girls', 'girl', 'boys', 'boy', 'kids', 'kid', 'unisex', 'her', 'his',
  // size and age (the size field says this)
  'size', 'small', 'medium', 'large', 'one', 'age', 'ages', 'year', 'years',
  // condition (the quality field says this)
  'new', 'bnwt', 'tags', 'worn', 'used', 'condition',
  // colours: without these, liking a black dress gives points to black boots
  // and black trousers. Gold and silver stay, as they are often the material.
  'black', 'white', 'grey', 'gray', 'charcoal', 'navy', 'blue', 'red', 'pink',
  'green', 'emerald', 'yellow', 'mustard', 'orange', 'purple', 'burgundy',
  'brown', 'tan', 'beige', 'cream', 'ivory', 'khaki', 'pale', 'light', 'dark',
]);

// Sizes and qualities come from the app's dropdowns ("Medium", "GOOD"), so
// trimming and lowercasing is enough to compare them. Older listings may have
// no value at all.
export function normalise(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

// The words in a title that say what the item is, each listed once.
// "BNWT Men's checked shirts M" -> ["checked", "shirt"]
export function titleWords(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/['’]s\b/g, '') // "men's" -> "men"
    .split(/[^a-z]+/) // letters only: drops numbers, sizes like "M", emoji
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map(singular);
  return [...new Set(words)];
}

// So "shirts" matches "shirt". Every title goes through the same rule, so a
// brand like "Adidas" becomes "adida" on both sides and still matches.
function singular(word: string): string {
  if (/(ss|sh|ch|x)es$/.test(word)) {
    return word.slice(0, -2); // "dresses" -> "dress"
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1); // "shirts" -> "shirt", but "dress" stays
  }
  return word;
}

// How big a part of the user's taste one value is, from 0 to 1.
// counts { men: 3, women: 1 } -> share for "men" is 3 / 4 = 0.75
export function share(counts: Map<string, number>, key: string): number {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  if (total === 0) {
    return 0;
  }
  return (counts.get(key) ?? 0) / total;
}

// What one user's likes and purchases say about their taste. Each map counts
// how often a value appears, weighted: a like adds 1, a purchase adds 3.
export interface TasteProfile {
  categories: Map<string, number>;
  sizes: Map<string, number>;
  qualities: Map<string, number>;
  charities: Map<string, number>;
  sellers: Map<string, number>;
  // Each title word, with its weight: 1 if the newest like (or any purchase)
  // had it, less if only older likes did.
  words: Map<string, number>;
  priceRange: { min: number; max: number } | null;
  // The categories they have bought from. Used to spot gifts (see rankProducts).
  boughtCategories: Set<string>;
}

export const LIKE_WEIGHT = 1;
export const PURCHASE_WEIGHT = 3;

// Newer likes count a little more: the newest like counts 1, the one before
// 0.95, then 0.9025, and so on, so a like counts half after about 14 newer
// likes. Without this, every new like matters less than the last (a 10th like
// only moves the taste by about 1/10), so the feed is slow to follow a change
// of taste. 0.95 is a mild decay: in Pinterest's tests, mild decay beat both no
// decay and strong decay. 0.9 and 0.8 faded too fast for someone who likes
// many items in one visit.
export const LIKE_DECAY = 0.95;

// Built fresh on every request and never saved. `liked` must be newest first.
export function buildTasteProfile(
  liked: Product[],
  bought: Product[],
  userId: string,
): TasteProfile {
  const profile: TasteProfile = {
    categories: new Map(),
    sizes: new Map(),
    qualities: new Map(),
    charities: new Map(),
    sellers: new Map(),
    words: new Map(),
    priceRange: null,
    boughtCategories: new Set(),
  };

  const signals = [
    ...liked.map((product, index) => ({
      product,
      weight: LIKE_WEIGHT * LIKE_DECAY ** index,
      isPurchase: false,
    })),
    ...bought.map((product) => ({
      product,
      weight: PURCHASE_WEIGHT,
      isPurchase: true,
    })),
  ];

  for (const { product, weight, isPurchase } of signals) {
    // Old data can hold likes on your own listing. They say nothing about
    // your taste, so they are skipped.
    if (product.userId === userId) {
      continue;
    }
    addCount(profile.categories, product.categoryId, weight);
    if (isPurchase && product.categoryId) {
      profile.boughtCategories.add(product.categoryId);
    }
    addCount(profile.sizes, normalise(product.size), weight);
    addCount(profile.qualities, normalise(product.quality), weight);
    addCount(profile.charities, product.charityId, weight);
    addCount(profile.sellers, product.userId, weight);
    // A word is as fresh as the newest like that had it, so the words of old
    // likes fade at the same mild rate as the rest. A purchase counts 1.
    const wordWeight = Math.min(1, weight);
    for (const word of titleWords(product.name ?? '')) {
      profile.words.set(
        word,
        Math.max(profile.words.get(word) ?? 0, wordWeight),
      );
    }
    if (Number.isFinite(product.price)) {
      profile.priceRange = {
        min: Math.min(profile.priceRange?.min ?? product.price, product.price),
        max: Math.max(profile.priceRange?.max ?? product.price, product.price),
      };
    }
  }

  return profile;
}

// Adds weight to one value's count. Empty values are skipped, so a listing
// with no size doesn't create a "" size.
function addCount(
  counts: Map<string, number>,
  key: string | undefined,
  weight: number,
): void {
  if (!key) {
    return;
  }
  counts.set(key, (counts.get(key) ?? 0) + weight);
}

// How much each signal can add to a score, tuned on the seed data. What the
// item is (its title words) counts more than its size, so liking a dress shows
// other dresses, not boots in the same size. Seller and charity only break
// ties. The best possible score is 10.
export const WEIGHTS = {
  category: 3,
  size: 1,
  price: 1,
  titleWord: 2,
  titleWordsMax: 3,
  quality: 1,
  charity: 0.25,
  seller: 0.25,
  recency: 0.5,
};

// A price is "in range" from 0 up to double the dearest item the user liked or
// bought (100% either side of their range). Cheaper never loses points: a low
// price is the main reason people buy second-hand.
export const PRICE_MARGIN = 1;

// A new listing gets a small boost that fades to nothing over 14 days.
export const RECENCY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// One number for how well a product matches the user's taste. Higher means a
// better match. `now` is passed in, so tests can fix the time.
export function scoreProduct(
  product: Product,
  profile: TasteProfile,
  now: Date,
): number {
  let score = 0;
  score += WEIGHTS.category * share(profile.categories, product.categoryId);
  score += WEIGHTS.size * share(profile.sizes, normalise(product.size));
  score +=
    WEIGHTS.quality * share(profile.qualities, normalise(product.quality));
  score += WEIGHTS.charity * share(profile.charities, product.charityId);
  score += WEIGHTS.seller * share(profile.sellers, product.userId);
  if (isInPriceRange(product.price, profile.priceRange)) {
    score += WEIGHTS.price;
  }
  score += Math.min(
    WEIGHTS.titleWordsMax,
    WEIGHTS.titleWord * sharedWords(product.name, profile.words),
  );
  score += WEIGHTS.recency * freshness(product.createdAt, now);
  return score;
}

function isInPriceRange(
  price: number,
  range: TasteProfile['priceRange'],
): boolean {
  if (!range || !Number.isFinite(price)) {
    return false;
  }
  return (
    price >= range.min * (1 - PRICE_MARGIN) &&
    price <= range.max * (1 + PRICE_MARGIN)
  );
}

// How many of the title's words are also in the user's taste words. Each one
// counts its word weight: 1 from the newest like, 0.95 from the like before...
function sharedWords(title: string | undefined, words: Map<string, number>) {
  let total = 0;
  for (const word of titleWords(title ?? '')) {
    total += words.get(word) ?? 0;
  }
  return total;
}

// 1 for a listing made just now, falling to 0 after RECENCY_DAYS.
function freshness(createdAt: Date | undefined, now: Date): number {
  if (!(createdAt instanceof Date)) {
    return 0;
  }
  const ageInDays = (now.getTime() - createdAt.getTime()) / DAY_MS;
  return Math.min(1, Math.max(0, 1 - ageInDays / RECENCY_DAYS));
}

// Every 5th slot in the feed goes to something outside the user's main taste,
// so the feed doesn't turn into more of the same (a "filter bubble").
export const MIX_EVERY = 5;

// The feed is planned in blocks of 10 items.
const BLOCK_SIZE = 10;

// A category they bought from that isn't their main one is often a gift (a
// dress for a partner, a jumper for a child). Each such "gift kind" gets slots
// in line with how much of their taste it is, up to 2 in every 10.
export const GIFT_MAX_SHARE = 0.2;

// Where gift items go in each block of 10: first the "something different"
// slots (5 and 10), then these. That leaves at least 4 in 10 for the main taste.
const EXTRA_GIFT_POSITIONS = [3, 8, 4, 9];

// Puts the candidates in feed order.
// - No likes or purchases yet ("cold start"): newest first, like /with-details.
// - Otherwise: highest score first; on a tie, the newer item first.
// - Gift kinds get their planned slots (see giftPlan). Outside those slots
//   they are left out, so a gift never takes over the feed.
// - Any "something different" slot without a gift goes to the newest item from
//   a category they haven't liked or bought.
// If a planned slot has nothing left to show, it takes the next best score.
export function rankProducts(
  candidates: Product[],
  profile: TasteProfile,
  now: Date,
): Product[] {
  const newestFirst = [...candidates].sort(byNewest);
  if (isColdStart(profile)) {
    return newestFirst;
  }

  const bestFirst = candidates
    .map((product) => ({ product, score: scoreProduct(product, profile, now) }))
    .sort((a, b) => b.score - a.score || byNewest(a.product, b.product))
    .map(({ product }) => product);
  const outsideTaste = newestFirst.filter(
    (product) => !profile.categories.has(product.categoryId),
  );
  const plan = giftPlan(profile);
  const giftKinds = new Set(plan.values());

  const ranked: Product[] = [];
  const used = new Set<Product>();
  const take = (list: Product[], test: (product: Product) => boolean) => {
    const found = list.find((product) => !used.has(product) && test(product));
    if (found) {
      used.add(found);
    }
    return found;
  };

  while (ranked.length < candidates.length) {
    const position = (ranked.length % BLOCK_SIZE) + 1;
    const giftCategory = plan.get(position);
    const isMixSlot = position % MIX_EVERY === 0;
    const next =
      (giftCategory &&
        take(bestFirst, (product) => product.categoryId === giftCategory)) ||
      (isMixSlot && take(outsideTaste, () => true)) ||
      take(bestFirst, (product) => !giftKinds.has(product.categoryId)) ||
      take(bestFirst, () => true);
    if (!next) {
      break;
    }
    ranked.push(next);
  }
  return ranked;
}

// Which gift kind goes in which position of each block of 10.
// Example: a dress buyer who bought a shirt for a partner and a jumper for a
// child gets one of those kinds in slots 5 and 3, the other in slots 10 and 8.
function giftPlan(profile: TasteProfile): Map<number, string> {
  const main = mainCategory(profile);
  const giftKinds = [...profile.boughtCategories]
    .filter((category) => category !== main)
    .map((category) => ({
      category,
      slots: Math.round(
        Math.min(share(profile.categories, category), GIFT_MAX_SHARE) *
          BLOCK_SIZE,
      ),
    }))
    .filter((gift) => gift.slots > 0)
    .sort((a, b) => b.slots - a.slots || a.category.localeCompare(b.category));

  // Take turns: one slot for each gift kind, then a second round.
  const turns: string[] = [];
  for (let round = 0; round < BLOCK_SIZE; round++) {
    for (const gift of giftKinds) {
      if (round < gift.slots) {
        turns.push(gift.category);
      }
    }
  }

  const mixPositions = Array.from(
    { length: BLOCK_SIZE },
    (_, i) => i + 1,
  ).filter((position) => position % MIX_EVERY === 0);
  const positions = [...mixPositions, ...EXTRA_GIFT_POSITIONS];
  const plan = new Map<number, string>();
  turns.slice(0, positions.length).forEach((category, i) => {
    plan.set(positions[i], category);
  });
  return plan;
}

// The category with the biggest part of their taste.
function mainCategory(profile: TasteProfile): string | undefined {
  let main: string | undefined;
  let biggest = 0;
  for (const [category, count] of profile.categories) {
    if (count > biggest) {
      main = category;
      biggest = count;
    }
  }
  return main;
}

// True when the user has no likes or purchases to learn from.
export function isColdStart(profile: TasteProfile): boolean {
  const counts = [
    profile.categories,
    profile.sizes,
    profile.qualities,
    profile.charities,
    profile.sellers,
  ];
  return counts.every((map) => map.size === 0) && profile.words.size === 0;
}

// Newest first. On the same time, the higher id first, which is the same
// order Firestore gives /with-details.
function byNewest(a: Product, b: Product): number {
  const timeDifference = timeOf(b) - timeOf(a);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  const idA = a.id ?? '';
  const idB = b.id ?? '';
  return idA === idB ? 0 : idA > idB ? -1 : 1;
}

function timeOf(product: Product): number {
  return product.createdAt instanceof Date ? product.createdAt.getTime() : 0;
}
