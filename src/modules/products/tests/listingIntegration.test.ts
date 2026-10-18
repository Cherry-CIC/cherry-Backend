// Opt in with LISTING_INTEGRATION_TESTS=true and all three loopback emulator hosts.
// The dedicated demo project and per-run IDs keep other local fixtures untouched.
import { localFirebaseEmulators } from '../../../shared/config/firebaseEmulators';

jest.mock('../../../shared/config/firebaseConfig', () => {
  if (process.env.LISTING_INTEGRATION_TESTS !== 'true')
    return { firestore: {} };
  const {
    localFirebaseEmulators,
  } = require('../../../shared/config/firebaseEmulators');
  if (
    !localFirebaseEmulators() ||
    process.env.FIREBASE_PROJECT_ID !== 'demo-cherry-integration'
  )
    throw new Error(
      'Integration tests require loopback emulators and demo-cherry-integration.',
    );
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  return {
    firestore: getFirestore(
      initializeApp(
        { projectId: 'demo-cherry-integration' },
        'listing-integration',
      ),
    ),
  };
});

import { firestore } from '../../../shared/config/firebaseConfig';
import { ProductRepository } from '../repositories/ProductRepository';
import {
  OrderRepository,
  CreatePendingOrderInput,
  VerifiedOrderPayment,
} from '../../order/repositories/OrderRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { parseListingEdit } from '../validators/productValidator';
import { exposedListing } from '../../../shared/utils/listingSafety';

const integration =
  process.env.LISTING_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
integration('listing and checkout transactions on real Firestore', () => {
  // Firestore retries contended transactions with backoff.
  jest.setTimeout(30_000);
  const prefix = `listing_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let seller = '';
  let buyer = '';
  const productRepo = new ProductRepository(firestore);
  const orders = new OrderRepository();
  const created: FirebaseFirestore.DocumentReference[] = [];
  let id: string;
  let ref: FirebaseFirestore.DocumentReference;
  let selection: CreatePendingOrderInput;
  let counter = 0;
  const track = (collection: string, key: string) => {
    const result = firestore.collection(collection).doc(key);
    created.push(result);
    return result;
  };
  const reserve = (
    overrides: Partial<CreatePendingOrderInput> = {},
    expected: number | undefined = 0,
  ) => {
    const orderId = `${id}_order_${++counter}`;
    track('orders', orderId);
    return orders.createPendingOrder(
      orderId,
      { ...selection, ...overrides },
      expected,
    );
  };
  const verified = (): VerifiedOrderPayment => ({
    userId: buyer,
    sellerId: seller,
    charityId: 'charity',
    productId: id,
    shippingMethodId: '3747',
    shippingMethodName: 'Test locker',
    pickupPointId: '123',
    destinationCountry: 'GB',
    destinationPostalCode: 'SW1A 1AA',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 1000,
    productAmount: 700,
    shippingFee: 300,
    securityFee: 100,
    totalAmount: 1100,
    currency: 'GBP',
  });
  beforeAll(() => {
    expect(localFirebaseEmulators()).toBeDefined();
  });
  beforeEach(async () => {
    id = `${prefix}_${++counter}`;
    seller = `${id}_seller`;
    buyer = `${id}_buyer`;
    ref = track('products', id);
    await ref.set({
      userId: seller,
      name: 'Blue jumper',
      description: 'Original',
      categoryId: 'old',
      charityId: 'charity',
      price: 7,
      donation: 7,
      quality: 'GOOD',
      size: 'Medium',
      postageSize: 'small',
      number: 2,
      likes: 3,
      status: 'active',
      product_images: ['https://example.test/original.png'],
    });
    selection = {
      userId: buyer,
      sellerId: seller,
      charityId: 'charity',
      email: 'buyer@cherry.test',
      productId: id,
      productName: 'Blue jumper',
      listingEditVersion: 0,
      stripeCustomerId: 'cus_test',
      deliveryType: 'pickup_point',
      shippingOptionId: '3747',
      shippingOptionName: 'Test locker',
      shippingCarrier: 'inpost_gb',
      shippingWeight: 1000,
      productAmount: 700,
      shippingFee: 300,
      securityFee: 100,
      totalAmount: 1100,
      currency: 'GBP',
      shipping: {
        name: 'Test buyer',
        telephone: '+447700900123',
        address: {
          line1: 'Test locker',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
      },
      pickupPoint: {
        id: '123',
        name: 'Test locker',
        addressLine1: 'Test address',
        city: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
        carrier: 'inpost_gb',
      },
    };
  });
  afterAll(async () => {
    for (const item of created) await item.delete();
    await firestore.terminate();
  });

  test('legacy read starts at zero; sparse edit preserves protected fields and advances version', async () => {
    expect(exposedListing((await ref.get()).data()!).editVersion).toBe(0);
    const updated = await productRepo.update(
      id,
      { expectedEditVersion: 0, name: 'New title' },
      seller,
    );
    expect(updated).toMatchObject({
      name: 'New title',
      description: 'Original',
      price: 7,
      charityId: 'charity',
      number: 2,
      likes: 3,
      editVersion: 1,
    });
    expect((await ref.get()).data()).not.toHaveProperty('expectedEditVersion');
    await expect(
      productRepo.update(
        id,
        { expectedEditVersion: 0, name: 'Stale title' },
        seller,
      ),
    ).rejects.toMatchObject({ code: 'LISTING_VERSION_CONFLICT' });
  });
  test('all six editable fields and photo order commit together', async () => {
    const category = track('categories', `${prefix}_category`);
    await category.set({ name: 'Coats' });
    const updated = await productRepo.update(
      id,
      {
        expectedEditVersion: 0,
        name: 'New jumper',
        description: '',
        categoryId: category.id,
        quality: 'EXCELLENT',
        size: 'Small',
        product_images: [
          'https://example.test/b.png',
          'https://example.test/a.png',
        ],
      },
      seller,
    );
    expect(updated).toMatchObject({
      name: 'New jumper',
      description: '',
      categoryId: category.id,
      quality: 'EXCELLENT',
      size: 'Small',
      product_images: [
        'https://example.test/b.png',
        'https://example.test/a.png',
      ],
      editVersion: 1,
    });
  });
  test.each(['', 'other'])(
    'rejects non-owner %s without a write',
    async (uid) => {
      await expect(
        productRepo.update(
          id,
          { expectedEditVersion: 0, name: 'Rejected' },
          uid,
        ),
      ).rejects.toMatchObject({ status: uid ? 403 : 401 });
      expect((await ref.get()).data()!.name).toBe('Blue jumper');
    },
  );
  test.each([
    { status: 'sold' },
    { status: 'unexpected' },
    { number: 0 },
    { hasSales: true },
    { hidden: true },
    { editVersion: -1 },
  ])('blocks ineligible listing %j', async (state) => {
    await ref.update(state);
    await expect(
      productRepo.update(
        id,
        { expectedEditVersion: 0, name: 'Rejected' },
        seller,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  test('retained refunded purchase history prevents editing and deletion', async () => {
    await track('orders', `${id}_history`).set({
      productId: id,
      paymentStatus: 'refunded',
      status: 'failed',
    });
    await expect(
      productRepo.update(
        id,
        { expectedEditVersion: 0, name: 'Rejected' },
        seller,
      ),
    ).rejects.toHaveProperty('code', 'LISTING_HAS_SALES');
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).rejects.toHaveProperty('code', 'LISTING_HAS_SALES');
  });
  test('only one concurrent edit can commit', async () => {
    const result = await Promise.allSettled(
      ['First title', 'Second title'].map((name) =>
        productRepo.update(id, { expectedEditVersion: 0, name }, seller),
      ),
    );
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect((await ref.get()).data()!.editVersion).toBe(1);
  });
  test.each([1, 2, 3])(
    'edit and reservation race has one winner (%s)',
    async () => {
      const result = await Promise.allSettled([
        productRepo.update(
          id,
          { expectedEditVersion: 0, name: 'Changed title' },
          seller,
        ),
        reserve(),
      ]);
      expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(
        (
          result.find(
            (item) => item.status === 'rejected',
          ) as PromiseRejectedResult
        ).reason.status,
      ).toBe(409);
    },
  );
  test('checkout reuses the same selection and rejects another buyer or changed selection', async () => {
    const first = await reserve();
    expect((await reserve()).id).toBe(first.id);
    await expect(reserve({ userId: 'another-buyer' })).rejects.toHaveProperty(
      'code',
      'LISTING_PAYMENT_PENDING',
    );
    await expect(
      reserve({
        shipping: { ...selection.shipping, telephone: '+447700900999' },
      }),
    ).rejects.toHaveProperty('code', 'LISTING_PAYMENT_PENDING');
  });
  test('expiry alone does not unlock an actionable payment', async () => {
    const pending = await reserve();
    await firestore
      .collection('orders')
      .doc(pending.id)
      .update({ paymentExpiresAt: new Date(0) });
    await expect(
      productRepo.update(
        id,
        { expectedEditVersion: 0, name: 'Rejected' },
        seller,
      ),
    ).rejects.toHaveProperty('code', 'LISTING_PAYMENT_PENDING');
    await orders.attachPaymentIntent(pending.id, 'pi_cancelled');
    await orders.releasePendingOrder(pending.id, 'pi_cancelled');
    expect(
      (
        await productRepo.update(
          id,
          { expectedEditVersion: 0, name: 'Now editable' },
          seller,
        )
      ).editVersion,
    ).toBe(1);
  });
  test('late successful payment finalises once and permanently blocks editing after a partial sale', async () => {
    const pending = await reserve();
    const intentId = `${id}_intent`;
    track('order_payment_intents', intentId);
    track('order_fulfillment_jobs', pending.id);
    await orders.attachPaymentIntent(pending.id, intentId);
    await firestore
      .collection('orders')
      .doc(pending.id)
      .update({ paymentExpiresAt: new Date(0) });
    await orders.finalizePendingOrder(pending.id, intentId, verified());
    await orders.finalizePendingOrder(pending.id, intentId, verified());
    expect((await ref.get()).data()).toMatchObject({
      number: 1,
      hasSales: true,
      editVersion: 1,
    });
    await expect(
      productRepo.update(
        id,
        { expectedEditVersion: 1, name: 'Rejected' },
        seller,
      ),
    ).rejects.toHaveProperty('code', 'LISTING_HAS_SALES');
  });
  test('missing buyer version is compatible only with unedited listings', async () => {
    await productRepo.update(
      id,
      { expectedEditVersion: 0, name: 'Edited title' },
      seller,
    );
    const orderId = `${id}_legacy`;
    track('orders', orderId);
    await expect(
      orders.createPendingOrder(orderId, {
        ...selection,
        listingEditVersion: 1,
      }),
    ).rejects.toHaveProperty('code', 'LISTING_VERSION_REQUIRED');
  });
  test('availability changes advance the version', async () => {
    await productRepo.changeAvailability(id, seller, 'unlisted');
    await productRepo.changeAvailability(id, seller, 'active');
    expect((await ref.get()).data()!.editVersion).toBe(2);
    await expect(reserve()).rejects.toHaveProperty(
      'code',
      'LISTING_VERSION_CONFLICT',
    );
  });
  test('account deletion cannot remove either participant during checkout', async () => {
    await reserve();
    for (const uid of [seller, buyer]) {
      await expect(
        new UserRepository().deleteAccountData(uid),
      ).rejects.toHaveProperty('code', 'ACCOUNT_PAYMENT_PENDING');
      expect(
        (await firestore.collection('account_deletions').doc(uid).get()).exists,
      ).toBe(false);
    }
  });
  test.each(['buyer', 'seller'])(
    'account deletion and checkout serialize for the %s',
    async (participant) => {
      const uid = participant === 'buyer' ? buyer : seller;
      track('account_deletions', uid);
      const result = await Promise.allSettled([
        reserve(),
        new UserRepository().deleteAccountData(uid),
      ]);
      expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
        1,
      );
    },
  );
  test('a deletion tombstone prevents new checkout', async () => {
    const deletion = track('account_deletions', buyer);
    await deletion.set({ startedAt: new Date() });
    await expect(reserve()).rejects.toHaveProperty(
      'code',
      'ACCOUNT_DELETION_PENDING',
    );
    await deletion.delete();
  });
});

describe('listing version validation', () => {
  test.each([undefined, null, -1, 1.1, '1', Number.MAX_SAFE_INTEGER])(
    'rejects invalid expected version %s',
    (value) => {
      expect(() =>
        parseListingEdit({ name: 'New title', expectedEditVersion: value }),
      ).toThrow();
    },
  );
  test('requires a changed field and rejects protected fields', () => {
    expect(() => parseListingEdit({ expectedEditVersion: 0 })).toThrow();
    expect(() =>
      parseListingEdit({ expectedEditVersion: 0, price: 5 }),
    ).toThrow();
  });
});
