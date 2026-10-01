import { UserProductRepository } from '../../users/repositories/UserProductRepository';
import { ProductLikeRepository } from '../repositories/ProductLikeRepository';
import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  deleteObject,
  updateMetadata,
} from 'firebase/storage';

jest.mock('../../../shared/config/firebaseConfig', () => {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app =
    getApps()[0] ?? initializeApp({ projectId: 'demo-cherry-listing' });
  return { firestore: getFirestore(app) };
});
import { firestore } from '../../../shared/config/firebaseConfig';
import { ProductRepository } from '../../../modules/products/repositories/ProductRepository';
import { ListingReservationRepository } from '../../../modules/payment/repositories/ListingReservationRepository';
import { OrderRepository } from '../../../modules/order/repositories/OrderRepository';
import { UserRepository } from '../../../modules/auth/repositories/UserRepository';
import { exposedListing } from '../../../shared/utils/listingSafety';
import { parseListingEdit } from '../../../modules/products/validators/productValidator';

const repo = new ProductRepository();
const reservations = new ListingReservationRepository();
let env: RulesTestEnvironment;
const base = {
  name: 'Blue jumper',
  description: 'Original',
  categoryId: 'cat',
  charityId: 'charity',
  postageSize: 'small',
  userId: 'seller',
  quality: 'GOOD',
  size: 'Small',
  product_images: ['https://example.invalid/one'],
  donation: 10,
  price: 10,
  number: 2,
  likes: 0,
  status: 'active',
  editVersion: 0,
  editSafetyVerified: true,
  hasSales: false,
  hasBeenEdited: false,
  createdAt: new Date(),
};
const reserve = (
  userId = 'buyer',
  expectedEditVersion: number | undefined = 0,
) =>
  reservations.reserve({
    productId: 'listing',
    userId,
    customerId: `cus_${userId}`,
    expectedEditVersion,
    quotedVersion: expectedEditVersion ?? 0,
    selectionKey: 'selection',
    quotedPrice: 10,
    quotedPostageSize: 'small',
    totalAmount: 1500,
    metadata: { firebaseUid: userId, productId: 'listing' },
  });
const edit = (extra = {}, uid = 'seller') =>
  repo.update(
    'listing',
    { expectedEditVersion: 0, name: 'Green jumper', ...extra },
    uid,
  );
const product = async () =>
  (await firestore.doc('products/listing').get()).data()!;

beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') &&
    !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('localhost:')
  )
    throw new Error('Local emulator required');
  env = await initializeTestEnvironment({
    projectId: 'demo-cherry-listing',
    firestore: {
      host: '127.0.0.1',
      port: 8188,
      rules: readFileSync('security/firestore.rules', 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9298,
      rules: readFileSync('security/storage.rules', 'utf8'),
    },
  });
});
beforeEach(async () => {
  process.env.LISTING_EDIT_ENABLED = 'true';
  await env.clearFirestore();
  await env.clearStorage();
  await firestore.doc('products/listing').set(base);
  await firestore.doc('categories/cat').set({ name: 'Clothing' });
});
afterAll(async () => {
  await env?.cleanup();
  await firestore.terminate();
});

test.each([
  { name: ' Red jumper ' },
  { description: '' },
  { categoryId: 'cat' },
  { quality: 'NEW' },
  { size: 'Medium' },
  {
    product_images: [
      'https://example.invalid/two',
      'https://example.invalid/one',
    ],
  },
])('sparse atomic edit preserves omitted fields: %j', async (changes) => {
  const result = await edit(changes);
  expect(result.editVersion).toBe(1);
  expect(await product()).toMatchObject({
    charityId: base.charityId,
    price: base.price,
    number: base.number,
    ...changes,
    name: changes.name?.trim() ?? 'Green jumper',
  });
});
test('two edits with the same version cannot both commit', async () => {
  const results = await Promise.allSettled([
    edit(),
    edit({ description: 'Other' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await product()).editVersion).toBe(1);
});
test.each(['buyer', ''])(
  'ownership is enforced within the transaction (%s)',
  async (uid) => {
    await expect(edit({}, uid)).rejects.toMatchObject({
      code: uid ? 'LISTING_NOT_OWNER' : 'AUTHENTICATION_REQUIRED',
    });
    expect((await product()).editVersion).toBe(0);
  },
);
test.each([
  'price',
  'number',
  'charityId',
  'userId',
  'editVersion',
  'status',
  'paymentReservationId',
  'surprise',
])('rejects forbidden field %s', (key) => {
  expect(() =>
    parseListingEdit({ expectedEditVersion: 0, name: 'Good title', [key]: 1 }),
  ).toThrow();
});
test.each([undefined, -1, 0.5, '0', null, Number.MAX_SAFE_INTEGER])(
  'rejects invalid expected version %s',
  (version) => {
    expect(() =>
      parseListingEdit({ expectedEditVersion: version, name: 'Good title' }),
    ).toThrow();
  },
);
test.each([
  { quality: 'Premium' },
  { size: 'Other' },
  { name: '  a ' },
  { product_images: [] },
  { description: 'a'.repeat(501) },
])('rejects invalid edit %j', (changes) => {
  expect(() =>
    parseListingEdit({ expectedEditVersion: 0, ...changes }),
  ).toThrow();
});
test('missing category is rejected without a write', async () => {
  await expect(edit({ categoryId: 'missing' })).rejects.toMatchObject({
    code: 'LISTING_INVALID_CATEGORY',
  });
  expect((await product()).editVersion).toBe(0);
});
test('unlisted positive-stock listings can be edited', async () => {
  await firestore.doc('products/listing').update({ status: 'unlisted' });
  await expect(edit()).resolves.toMatchObject({
    status: 'unlisted',
    editVersion: 1,
  });
});
test.each([
  { status: 'sold', number: 0 },
  { hasSales: true },
  { editSafetyVerified: false },
])('blocks unsafe listing %j', async (updates) => {
  await firestore.doc('products/listing').update(updates);
  await expect(edit()).rejects.toThrow();
  expect((await product()).name).toBe(base.name);
});
test.each(['cancelled', 'refunded', 'paid'])(
  'any historical order blocks editing, including %s',
  async (status) => {
    await firestore.doc('orders/old').set({ productId: 'listing', status });
    await expect(edit()).rejects.toMatchObject({ code: 'LISTING_HAS_SALES' });
  },
);
test('edit and reservation cannot both win the reviewed version', async () => {
  const results = await Promise.allSettled([edit(), reserve()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await product()).editVersion).toBe(1);
});
test('two buyers cannot reserve the same stock concurrently', async () => {
  const results = await Promise.allSettled([
    reserve('buyer'),
    reserve('other'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
});
test('same buyer retries reuse the reservation', async () => {
  const first = await reserve();
  const second = await reserve();
  expect(second.id).toBe(first.id);
  expect((await product()).editVersion).toBe(1);
});
test('expiry and failure do not release actionable payments; cancellation does', async () => {
  const reservation = await reserve();
  await reservations.attachIntent(reservation, 'pi_test');
  await firestore
    .doc(`listing_payment_reservations/${reservation.id}`)
    .update({ expiresAtMs: 0 });
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'requires_payment_method',
    metadata: reservation.metadata,
  });
  await expect(edit()).rejects.toMatchObject({
    code: 'LISTING_PAYMENT_PENDING',
  });
  for (const action of ['active', 'unlisted', 'delete'] as const)
    await expect(
      repo.changeAvailability('listing', 'seller', action),
    ).rejects.toMatchObject({ code: 'LISTING_PAYMENT_PENDING' });
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'canceled',
    metadata: reservation.metadata,
  });
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'canceled',
    metadata: reservation.metadata,
  });
  expect(await product()).toMatchObject({
    editVersion: 2,
    paymentReservationId: null,
  });
  await expect(edit({ expectedEditVersion: 2 })).resolves.toMatchObject({
    editVersion: 3,
  });
});
test('success and duplicate or delayed events keep purchased details frozen', async () => {
  const reservation = await reserve();
  await reservations.attachIntent(reservation, 'pi_test');
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'succeeded',
    metadata: reservation.metadata,
  });
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'succeeded',
    metadata: reservation.metadata,
  });
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'canceled',
    metadata: reservation.metadata,
  });
  expect(await product()).toMatchObject({
    editVersion: 2,
    hasSales: true,
    paymentReservationId: reservation.id,
  });
  await expect(edit({ expectedEditVersion: 2 })).rejects.toThrow();
});
test('older clients cannot start payment after an edit', async () => {
  await edit();
  await expect(
    reservations.reserve({
      productId: 'listing',
      userId: 'buyer',
      customerId: 'cus_buyer',
      quotedVersion: 1,
      quotedPrice: 10,
      quotedPostageSize: 'small',
      selectionKey: 'x',
      totalAmount: 1500,
      metadata: {},
    }),
  ).rejects.toMatchObject({ code: 'LISTING_VERSION_REQUIRED' });
});
test('legacy intent success freezes a non-certified listing', async () => {
  await firestore.doc('products/listing').update({ editSafetyVerified: false });
  await expect(edit()).rejects.toMatchObject({
    code: 'LISTING_SAFETY_REVIEW_REQUIRED',
  });
  await reservations.applyStripeState({
    id: 'pi_legacy',
    status: 'succeeded',
    metadata: { productId: 'listing', firebaseUid: 'buyer' },
  });
  expect((await product()).hasSales).toBe(true);
});
test('order retries cannot decrement inventory twice', async () => {
  const reservation = await reserve();
  await reservations.attachIntent(reservation, 'pi_test');
  await reservations.applyStripeState({
    id: 'pi_test',
    status: 'succeeded',
    metadata: reservation.metadata,
  });
  const input: any = {
    listingReservationId: reservation.id,
    userId: 'buyer',
    email: 'buyer@example.invalid',
    productAmount: 1000,
    shippingFee: 400,
    securityFee: 100,
    totalAmount: 1500,
    currency: 'GBP',
    productId: 'listing',
    productName: base.name,
    deliveryType: 'pickup_point',
    shippingOptionId: '1',
    shippingOptionName: 'Locker',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 1000,
    shipping: {},
    pickupPoint: {},
    paymentIntentId: 'pi_test',
    paymentStatus: 'succeeded',
    shipmentStatus: 'pending',
    status: 'paid',
  };
  const orders = new OrderRepository();
  const results = await Promise.all([
    orders.createPaidOrderAndDecrementInventory(input),
    orders.createPaidOrderAndDecrementInventory(input),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(await product()).toMatchObject({
    number: 1,
    hasSales: true,
    paymentReservationId: null,
    editVersion: 3,
  });
  await expect(edit({ expectedEditVersion: 3 })).rejects.toMatchObject({
    code: 'LISTING_HAS_SALES',
  });
});
test('account deletion cannot bypass a payment reservation', async () => {
  await reserve();
  await expect(
    new UserRepository().deleteAccountData('seller'),
  ).rejects.toMatchObject({ code: 'LISTING_PAYMENT_PENDING' });
  expect((await firestore.doc('account_deletions/seller').get()).exists).toBe(
    false,
  );
  expect((await product()).name).toBe(base.name);
});
test('account tombstone blocks both checkout and listing creation', async () => {
  await firestore
    .doc('account_deletions/seller')
    .set({ startedAt: new Date() });
  await expect(reserve()).rejects.toMatchObject({
    code: 'ACCOUNT_DELETION_PENDING',
  });
  await expect(repo.create(base as any)).rejects.toMatchObject({
    code: 'ACCOUNT_DELETION_PENDING',
  });
});
test('version exposure is gated and private reservation fields never leak', () => {
  const input = { ...base, paymentReservationId: 'secret' };
  expect(exposedListing(input)).toMatchObject({
    editVersion: 0,
    status: 'active',
  });
  expect(exposedListing(input)).not.toHaveProperty('paymentReservationId');
  delete process.env.LISTING_EDIT_ENABLED;
  expect(exposedListing(input)).not.toHaveProperty('editVersion');
});
test.each([
  'products/listing',
  'orders/purchase',
  'listing_payment_reservations/lock',
  'listing_payment_states/pi_test',
  'order_payment_intents/pi_test',
  'account_deletions/seller',
])('ordinary clients cannot write protected data %s', async (path) => {
  for (const context of [
    env.authenticatedContext('seller'),
    env.authenticatedContext('buyer'),
    env.unauthenticatedContext(),
  ]) {
    await assertFails(
      setDoc(doc(context.firestore(), path), {
        userId: 'seller',
        editVersion: 999,
      }),
    );
  }
});
test('users cannot access or promote another account', async () => {
  const own = env.authenticatedContext('seller').firestore();
  await assertSucceeds(
    setDoc(doc(own, 'users/seller'), { id: 'seller', username: 'seller' }),
  );
  await assertFails(updateDoc(doc(own, 'users/seller'), { admin: true }));
  await assertFails(
    getDoc(doc(env.authenticatedContext('buyer').firestore(), 'users/seller')),
  );
});
test('Storage enforces ownership, limits and permanent object immutability', async () => {
  const context = env.authenticatedContext('seller');
  const image = ref(context.storage(), 'listing-media-v1/seller/test.jpg');
  const metadata = {
    contentType: 'image/jpeg',
    customMetadata: { ownerUid: 'seller', mediaPolicy: 'listing-v1' },
  };
  await assertSucceeds(uploadBytes(image, new Uint8Array([1, 2, 3]), metadata));
  await assertFails(uploadBytes(image, new Uint8Array([4]), metadata));
  await assertFails(deleteObject(image));
  await assertFails(
    updateMetadata(image, { customMetadata: { ownerUid: 'buyer' } }),
  );
  await assertFails(
    uploadBytes(
      ref(
        env.authenticatedContext('buyer').storage(),
        'listing-media-v1/seller/other.jpg',
      ),
      new Uint8Array([1]),
      metadata,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(context.storage(), 'listing-media-v1/seller/missing.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(context.storage(), 'listing-media-v1/seller/large.jpg'),
      new Uint8Array(10 * 1024 * 1024 + 1),
      metadata,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(context.storage(), 'products/seller/legacy.jpg'),
      new Uint8Array([1]),
      metadata,
    ),
  );
});

test('canonical, feed, filtered, profile and liked reads return the committed version', async () => {
  await edit();
  const canonical = await repo.getById('listing');
  const feed = await repo.getAll();
  const filtered = await repo.getPageByFilters({ userId: 'seller' }, 10);
  const profile = await new UserProductRepository().getPage('seller', 10);
  const liked = await new ProductLikeRepository().setLikeStatus(
    'buyer',
    'listing',
    true,
  );
  for (const item of [
    canonical,
    feed[0],
    filtered.items[0],
    profile.products[0],
    liked.product,
  ]) {
    expect(exposedListing(item!)).toMatchObject({
      id: 'listing',
      editVersion: 1,
      status: 'active',
    });
    expect(exposedListing(item!)).not.toHaveProperty('hasBeenEdited');
  }
  expect((await product()).editVersion).toBe(1);
});
