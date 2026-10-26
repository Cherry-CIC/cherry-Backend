// Opt in only against the three loopback emulators and the dedicated demo
// project. Every fixture is scoped to this run and removed afterwards.
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
        'listing-deletion-integration',
      ),
    ),
  };
});

import { firestore } from '../../../shared/config/firebaseConfig';
import { ProductRepository } from '../repositories/ProductRepository';
import {
  CreatePendingOrderInput,
  OrderRepository,
} from '../../order/repositories/OrderRepository';
import { mediaKey } from '../cleanup/media';
import { ListingCleanupWorker } from '../cleanup/worker';
import { ReportRepository } from '../../reports/repositories/ReportRepository';
import { DAY_MS } from '../cleanup/jobs';

const integration =
  process.env.LISTING_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

integration('listing deletion transactions on real Firestore', () => {
  jest.setTimeout(30_000);
  const prefix = `deletion_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const bucket = 'demo-cherry-integration.appspot.com';
  const originalBucket = process.env.LISTING_MEDIA_BUCKET;
  const productRepo = new ProductRepository(firestore);
  const orders = new OrderRepository();
  const created: FirebaseFirestore.DocumentReference[] = [];
  let counter = 0;
  let id: string;
  let seller: string;
  let buyer: string;
  let ref: FirebaseFirestore.DocumentReference;
  let job: FirebaseFirestore.DocumentReference;
  let selection: CreatePendingOrderInput;

  const track = (collection: string, key: string) => {
    const result = firestore.collection(collection).doc(key);
    created.push(result);
    return result;
  };
  const photo = (filename: string) => {
    const name = `listing-media-v1/${seller}/${filename}.png`;
    return {
      bucket,
      name,
      url: `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket}/o/${encodeURIComponent(name)}?alt=media&token=disposable-test-token`,
    };
  };
  const reserve = () => {
    const orderId = `${id}_order_${++counter}`;
    track('orders', orderId);
    return orders.createPendingOrder(orderId, selection);
  };
  const expectIntact = async () => {
    expect((await ref.get()).exists).toBe(true);
    expect((await job.get()).exists).toBe(false);
  };

  beforeAll(() => {
    expect(localFirebaseEmulators()).toBeDefined();
    process.env.LISTING_MEDIA_BUCKET = bucket;
  });
  beforeEach(async () => {
    id = `${prefix}_${++counter}`;
    seller = `${id}_seller`;
    buyer = `${id}_buyer`;
    ref = track('products', id);
    job = track('listing_deletion_jobs', id);
    await ref.set({
      userId: seller,
      name: 'Blue jumper',
      description: 'Disposable listing',
      categoryId: 'test-category',
      charityId: 'charity',
      price: 7,
      donation: 7,
      quality: 'GOOD',
      size: 'Medium',
      postageSize: 'small',
      number: 2,
      likes: 3,
      status: 'active',
      product_images: [photo('original').url],
    });
    selection = {
      userId: buyer,
      sellerId: seller,
      charityId: 'charity',
      email: 'buyer@cherry.test',
      productId: id,
      productName: 'Blue jumper',
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
    try {
      for (let offset = 0; offset < created.length; offset += 400) {
        const batch = firestore.batch();
        created
          .slice(offset, offset + 400)
          .forEach((item) => batch.delete(item));
        await batch.commit();
      }
    } finally {
      if (originalBucket === undefined) delete process.env.LISTING_MEDIA_BUCKET;
      else process.env.LISTING_MEDIA_BUCKET = originalBucket;
      await firestore.terminate();
    }
  });

  test.each(['active', 'unlisted'])(
    'removes an owned %s listing and records its cleanup atomically',
    async (status) => {
      await ref.update({ status });
      const started = Date.now();
      await expect(
        productRepo.changeAvailability(id, seller, 'delete'),
      ).resolves.toBeNull();
      expect((await ref.get()).exists).toBe(false);
      const receipt = (await job.get()).data()!;
      expect(receipt).toMatchObject({
        productId: id,
        ownerUid: seller,
        status: 'pending',
        photos: [
          expect.objectContaining({ bucket, name: photo('original').name }),
        ],
      });
      expect(receipt.notBefore.toMillis()).toBeGreaterThanOrEqual(
        started + 30 * 24 * 60 * 60 * 1000,
      );
      expect(receipt.createdAt.toMillis()).toBeGreaterThanOrEqual(started);
      expect(receipt.nextAttemptAt).toBeDefined();
      // Download tokens and the listing's descriptive data are unnecessary
      // for object cleanup and must not be copied into the retained job.
      const stored = JSON.stringify(receipt);
      expect(stored).not.toContain('disposable-test-token');
      expect(stored).not.toContain('Blue jumper');
      expect(stored).not.toContain('Disposable listing');
    },
  );

  test.each(['', 'someone-else'])(
    'rejects non-owner %s without removing data or scheduling cleanup',
    async (uid) => {
      await expect(
        productRepo.changeAvailability(id, uid, 'delete'),
      ).rejects.toMatchObject({ status: uid ? 403 : 401 });
      await expectIntact();
    },
  );

  test('a repeated owner request succeeds without replacing its original receipt', async () => {
    await productRepo.changeAvailability(id, seller, 'delete');
    const receipt = (await job.get()).data();
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).resolves.toBeNull();
    expect((await job.get()).data()).toEqual(receipt);
    await expect(
      productRepo.changeAvailability(id, buyer, 'delete'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      productRepo.changeAvailability(id, '', 'delete'),
    ).rejects.toMatchObject({ status: 401 });
    expect((await job.get()).data()).toEqual(receipt);
  });

  test('concurrent owner requests leave one durable receipt', async () => {
    const results = await Promise.all([
      productRepo.changeAvailability(id, seller, 'delete'),
      productRepo.changeAvailability(id, seller, 'delete'),
    ]);
    expect(results).toEqual([null, null]);
    expect((await ref.get()).exists).toBe(false);
    expect((await job.get()).data()).toMatchObject({
      ownerUid: seller,
      productId: id,
      status: 'pending',
    });
  });

  test('an absent listing without an owner receipt is still not found', async () => {
    await ref.delete();
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).rejects.toMatchObject({ status: 404, code: 'LISTING_NOT_FOUND' });
    expect((await job.get()).exists).toBe(false);
  });

  test.each([
    { status: 'pending_payment', paymentStatus: 'pending' },
    { status: 'pending_payment', paymentStatus: 'processing' },
    { status: 'failed', paymentStatus: 'failed', reservationActive: true },
    { status: 'pending_payment', paymentExpiresAt: new Date(0) },
  ])('preserves a listing with an unresolved payment %j', async (payment) => {
    await track('orders', `${id}_payment`).set({ productId: id, ...payment });
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).rejects.toMatchObject({ status: 409, code: 'LISTING_PAYMENT_PENDING' });
    await expectIntact();
  });

  test.each([
    { status: 'completed', paymentStatus: 'paid' },
    { status: 'failed', paymentStatus: 'refunded' },
    { status: 'cancelled', paymentStatus: 'paid' },
    { status: 'failed', paymentStatus: 'failed' },
    {},
  ])('preserves known or uncertain purchase history %j', async (history) => {
    const order = track('orders', `${id}_history`);
    await order.set({ productId: id, ...history });
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).rejects.toMatchObject({ status: 409, code: 'LISTING_HAS_SALES' });
    await expectIntact();
    expect((await order.get()).data()).toEqual({ productId: id, ...history });
  });

  test.each([
    { hasSales: true },
    { status: 'sold' },
    { number: 0 },
    { number: -1 },
    { number: '2' },
  ])('retains sales or uncertain stock evidence %j', async (state) => {
    await ref.update(state);
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).rejects.toMatchObject({ status: 409, code: 'LISTING_HAS_SALES' });
    await expectIntact();
  });

  test('a confirmed unpaid cancellation permits deletion but keeps the order record', async () => {
    const order = track('orders', `${id}_cancelled`);
    const history = {
      productId: id,
      status: 'cancelled',
      paymentStatus: 'cancelled',
      reservationActive: false,
    };
    await order.set(history);
    await expect(
      productRepo.changeAvailability(id, seller, 'delete'),
    ).resolves.toBeNull();
    expect((await order.get()).data()).toEqual(history);
  });

  test.each([{ hidden: true }, { moderationStatus: 'hidden' }])(
    'preserves moderated listing evidence %j',
    async (state) => {
      await ref.update(state);
      await expect(
        productRepo.changeAvailability(id, seller, 'delete'),
      ).rejects.toMatchObject({ status: 409, code: 'LISTING_REVIEW_REQUIRED' });
      await expectIntact();
    },
  );

  test.each(['open', 'reviewing'])(
    'preserves a listing with a %s product report',
    async (status) => {
      const report = track('reports', `${id}_report`);
      const evidence = { targetType: 'product', targetId: id, status };
      await report.set(evidence);
      await expect(
        productRepo.changeAvailability(id, seller, 'delete'),
      ).rejects.toMatchObject({ status: 409, code: 'LISTING_REVIEW_REQUIRED' });
      await expectIntact();
      expect((await report.get()).data()).toEqual(evidence);
    },
  );

  test.each(['resolved', 'rejected'])(
    'a %s report does not block deletion and is retained',
    async (status) => {
      const report = track('reports', `${id}_report`);
      const evidence = { targetType: 'product', targetId: id, status };
      await report.set(evidence);
      await expect(
        productRepo.changeAvailability(id, seller, 'delete'),
      ).resolves.toBeNull();
      expect((await report.get()).data()).toEqual(evidence);
    },
  );

  test.each([1, 2, 3])(
    'checkout and deletion have exactly one winner (%s)',
    async () => {
      const results = await Promise.allSettled([
        productRepo.changeAvailability(id, seller, 'delete'),
        reserve(),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      if (results[0].status === 'fulfilled') {
        expect((await ref.get()).exists).toBe(false);
        expect((await job.get()).exists).toBe(true);
        const matchingOrders = await firestore
          .collection('orders')
          .where('productId', '==', id)
          .get();
        expect(matchingOrders.empty).toBe(true);
      } else {
        expect(results[0].reason).toMatchObject({
          code: 'LISTING_PAYMENT_PENDING',
        });
        await expectIntact();
      }
    },
  );

  test('a transaction failure after scheduling cleanup leaves the listing and likes intact', async () => {
    const like = track('user_likes', `${id}_like`);
    const savedLike = { productId: id, userId: buyer };
    await like.set(savedLike);
    const interruptedDb = {
      collection: firestore.collection.bind(firestore),
      runTransaction: <T>(
        callback: (tx: FirebaseFirestore.Transaction) => Promise<T>,
      ) =>
        firestore.runTransaction(async (tx) => {
          await callback(tx);
          throw new Error('Injected failure before commit');
        }),
    } as unknown as FirebaseFirestore.Firestore;
    await expect(
      new ProductRepository(interruptedDb).changeAvailability(
        id,
        seller,
        'delete',
      ),
    ).rejects.toThrow('Injected failure before commit');
    await expectIntact();
    expect((await like.get()).data()).toEqual(savedLike);
  });

  async function workerFixture() {
    await productRepo.changeAvailability(id, seller, 'delete');
    await job.update({ notBefore: new Date(0) });
    const candidate = photo('original');
    const retirement = track('listing_media_retirements', mediaKey(candidate));
    let now = new Date(Date.now() + 1000);
    const removed = new Set<string>();
    const storage = {
      inspect: jest.fn(async (object: { name: string }): Promise<string> =>
        removed.has(object.name) ? 'missing' : '123',
      ),
      remove: jest.fn(async (object: { name: string }, _generation: string) => {
        removed.add(object.name);
      }),
    };
    const worker = new ListingCleanupWorker(
      firestore,
      storage,
      () => now,
    );
    return {
      worker,
      storage,
      retirement,
      candidate,
      advance: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
    };
  }

  test('cleanup deletes only matching likes across bounded invocations and expires its minimal receipt', async () => {
    for (let offset = 0; offset < 1205; offset += 400) {
      const batch = firestore.batch();
      for (let i = offset; i < Math.min(offset + 400, 1205); i++)
        batch.set(track('user_likes', `${id}_${i}`), {
          productId: id,
          userId: `test_${i}`,
        });
      await batch.commit();
    }
    const unrelated = track('user_likes', `${id}_unrelated`);
    await unrelated.set({ productId: `${id}_other`, userId: buyer });
    const f = await workerFixture();
    const original = (await job.get()).data();
    await f.worker.run(1, false);
    expect((await job.get()).data()).toEqual(original);
    await f.worker.process(id);
    expect(
      (
        await firestore
          .collection('user_likes')
          .where('productId', '==', id)
          .get()
      ).size,
    ).toBe(205);
    f.advance(2000);
    await f.worker.process(id);
    expect(
      (
        await firestore
          .collection('user_likes')
          .where('productId', '==', id)
          .get()
      ).empty,
    ).toBe(true);
    expect((await unrelated.get()).exists).toBe(true);
    expect(f.storage.remove).toHaveBeenCalledWith(
      { bucket, name: f.candidate.name },
      '123',
    );
    expect((await job.get()).get('status')).toBe('completed');
    expect((await job.get()).data()).not.toHaveProperty('photos');
    f.advance(31 * DAY_MS);
    await f.worker.process(id);
    expect((await job.get()).exists).toBe(false);
    // The minimal hash marker prevents stale requests reattaching an erased object.
    expect((await f.retirement.get()).get('state')).toBe('retired');
  });

  test('likes are cleaned promptly while photos wait for the grace period', async () => {
    const like = track('user_likes', `${id}_liked`);
    await like.set({ productId: id, userId: buyer });
    const f = await workerFixture();
    await job.update({ notBefore: new Date(Date.now() + 30 * DAY_MS) });
    await f.worker.process(id);
    expect((await like.get()).exists).toBe(false);
    expect(f.storage.inspect).not.toHaveBeenCalled();
    expect((await job.get()).get('status')).toBe('waiting');
    expect((await job.get()).get('status')).toBe('waiting');
  });

  test('a temporary Storage failure retries the exact generation without resurrecting the listing', async () => {
    const f = await workerFixture();
    f.storage.remove.mockRejectedValueOnce(
      new Error('STORAGE_DELETION_FAILED'),
    );
    await f.worker.process(id);
    expect((await ref.get()).exists).toBe(false);
    expect((await job.get()).get('status')).toBe('pending');
    expect((await f.retirement.get()).get('generation')).toBe('123');
    f.advance(DAY_MS);
    await f.worker.process(id);
    expect(f.storage.remove).toHaveBeenCalledTimes(2);
    expect((await job.get()).get('status')).toBe('completed');
  });

  test('shared photo aliases survive until the surviving listing releases them', async () => {
    const f = await workerFixture();
    const shared = track('products', `${id}_shared`);
    await shared.set({
      userId: 'another-user',
      product_images: [`gs://${bucket}/${f.candidate.name}`],
    });
    await f.worker.process(id);
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect((await f.retirement.get()).exists).toBe(false);
    expect((await job.get()).get('lastError')).toBe('MEDIA_STILL_REFERENCED');
    await shared.delete();
    f.advance(8 * DAY_MS);
    await f.worker.process(id);
    expect(f.storage.remove).toHaveBeenCalledTimes(1);
  });

  test('nested historical order media remains protected', async () => {
    const f = await workerFixture();
    await track('orders', `${id}_shared_history`).set({
      productId: 'another-listing',
      snapshot: {
        image: `https://storage.googleapis.com/${bucket}/${f.candidate.name}`,
      },
    });
    await f.worker.process(id);
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect((await job.get()).get('status')).toBe('waiting');
  });

  test('unverified and replacement media are left for review', async () => {
    const f = await workerFixture();
    f.storage.inspect.mockResolvedValue('review');
    await f.worker.process(id);
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect((await job.get()).get('status')).toBe('review');
    await job.update({ status: 'pending', nextAttemptAt: new Date(0) });
    await f.retirement.set({ state: 'retired', generation: '122' });
    f.storage.inspect.mockResolvedValue('123');
    await f.worker.process(id);
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect((await job.get()).get('status')).toBe('review');
  });

  test('expired worker leases recover, while simultaneous workers do not duplicate deletion', async () => {
    const f = await workerFixture();
    await job.update({
      status: 'processing',
      leaseToken: 'dead-worker',
      leaseUntil: new Date(0),
      nextAttemptAt: new Date(0),
    });
    await f.retirement.set({
      state: 'retiring',
      jobId: id,
      leaseToken: 'dead-worker',
    });
    const results = await Promise.all([
      f.worker.process(id),
      f.worker.process(id),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(f.storage.remove).toHaveBeenCalledTimes(1);
    expect((await job.get()).get('status')).toBe('completed');
  });

  test('persistent failures stop automatic retries and remain visible for review', async () => {
    const f = await workerFixture();
    f.storage.remove.mockRejectedValue(new Error('STORAGE_DELETION_FAILED'));
    await job.update({ attempts: 7 });
    await f.worker.process(id);
    const data = (await job.get()).data()!;
    expect(data.status).toBe('review');
    expect(data.attempts).toBe(8);
    expect(data.nextAttemptAt).toBeUndefined();
    expect(data.lastError).toBe('STORAGE_DELETION_FAILED');
  });

  test('report creation and deletion cannot both commit', async () => {
    const reports = new ReportRepository(firestore);
    const results = await Promise.allSettled([
      reports.create({
        reporterId: buyer,
        targetType: 'product',
        targetId: id,
        reason: 'Test report',
      }),
      productRepo.changeAvailability(id, seller, 'delete'),
    ]);
    if (results[0].status === 'fulfilled')
      track('reports', results[0].value.id);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
  });

  test('report reopening and deletion cannot both commit', async () => {
    const reports = new ReportRepository(firestore);
    const report = track('reports', `${id}_reopen`);
    await report.set({
      targetType: 'product',
      targetId: id,
      status: 'resolved',
    });
    const results = await Promise.allSettled([
      reports.updateStatus(report.id, 'reviewing', 'admin'),
      productRepo.changeAvailability(id, seller, 'delete'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
  });

  test('adapter preserves an object overwritten after inspection in the real Storage emulator', async () => {
    const { getApp } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');
    const { ListingCleanupStorage } = await import('../cleanup/storage');
    const object = photo('storage-generation');
    const bucketClient = getStorage(
      getApp('listing-deletion-integration'),
    ).bucket(bucket);
    const file = bucketClient.file(object.name);
    const adapter = new ListingCleanupStorage(bucketClient, {
      LISTING_MEDIA_BUCKET: bucket,
      LISTING_MEDIA_POLICY_START: '2020-01-01T00:00:00Z',
    });
    const options = {
      resumable: false,
      metadata: {
        contentType: 'image/png',
        metadata: { ownerUid: seller, mediaPolicy: 'listing-v1' },
      },
    };
    try {
      await file.save(Buffer.from('disposable image fixture'), options);
      const first = await adapter.inspect(object, seller);
      expect(first).toMatch(/^[1-9][0-9]*$/);
      await file.save(Buffer.from('replacement disposable fixture'), options);
      const replacement = await adapter.inspect(object, seller);
      expect(replacement).not.toBe(first);
      await expect(adapter.remove(object, first)).rejects.toThrow(
        'STORAGE_GENERATION_CHANGED',
      );
      expect((await file.exists())[0]).toBe(true);
      await adapter.remove(object, replacement);
      expect((await file.exists())[0]).toBe(false);
      await expect(
        adapter.remove(object, replacement),
      ).resolves.toBeUndefined();
    } finally {
      await file.delete({ ignoreNotFound: true });
    }
  });
});
