import { randomBytes } from 'crypto';
import { admin, firestore } from '../../../shared/config/firebaseConfig';
import { DeletionService } from '../service';
import { AccountCleanup, sweepOwnedMedia } from '../cleanup';
import { loadDeletionPolicy } from '../config';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { CheckoutContextRepository } from '../../payment/CheckoutContextRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';

const db = firestore;
const auth = admin.auth();
const service = new DeletionService(db, auth);
const policy = loadDeletionPolicy();
const receipt = () => randomBytes(32).toString('base64url');
async function user(uid: string) {
  await auth.createUser({ uid, email: `${uid}@example.test` });
  await db
    .collection('users')
    .doc(uid)
    .set({ id: uid, email: `${uid}@example.test`, firstname: 'Test' });
}
async function drive(requestId: string, max = 80) {
  for (let i = 0; i < max; i++) {
    const job = db.collection('account_deletion_requests').doc(requestId);
    await job.update({ nextAttemptAt: new Date(0) });
    await service.process(
      requestId,
      new AccountCleanup(db, admin.storage(), policy),
    );
    const state = (await job.get()).get('state');
    if (
      ['completed', 'requires_review', 'retained', 'retrying'].includes(state)
    )
      return state;
  }
  throw new Error('Job did not reach a review/completion point');
}
beforeEach(async () => {
  await fetch(
    'http://127.0.0.1:8080/emulator/v1/projects/demo-cherry-deletion/databases/(default)/documents',
    { method: 'DELETE' },
  );
  await fetch(
    'http://127.0.0.1:9099/emulator/v1/projects/demo-cherry-deletion/accounts',
    { method: 'DELETE' },
  );
  const [files] = await admin.storage().bucket().getFiles();
  await Promise.all(files.map((file) => file.delete()));
});
afterAll(async () => {
  await db.terminate();
});

test('acceptance is durable/idempotent, reference alone fails, and guard hides all public reads', async () => {
  await user('owner');
  await db
    .doc('products/p')
    .set({ userId: 'owner', name: 'Coat', number: 1, price: 10 });
  const token = receipt();
  const first = await service.request('owner', token);
  expect((await service.request('owner', token)).requestId).toBe(
    first.requestId,
  );
  await expect(service.request('owner', receipt())).rejects.toThrow(
    'USE_EXISTING_STATUS_TOKEN',
  );
  expect(await new ProductRepository().getAll()).toEqual([]);
  expect(await new ProductRepository().getById('p')).toBeNull();
  await expect(
    service.statusWithReceipt(first.requestId, receipt()),
  ).rejects.toThrow('REQUEST_NOT_FOUND');
  expect((await service.statusWithReceipt(first.requestId, token)).state).toBe(
    'accepted',
  );
});

test('more than 450 descendants, missing parent, media variants and other owner isolation', async () => {
  await user('owner');
  for (let start = 0; start < 510; start += 100) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 100, 510); i++)
      batch.set(db.doc(`users/owner/private/missing/children/${i}`), {
        address: 'Test only',
      });
    await batch.commit();
  }
  await db.doc('users/other').set({ id: 'other', email: 'other@example.test' });
  await admin
    .storage()
    .bucket()
    .file('products/owner/thumb/a.jpg')
    .save('test');
  await admin.storage().bucket().file('products/other/a.jpg').save('other');
  const job = await service.request('owner', receipt());
  expect(await drive(job.requestId)).toBe('requires_review');
  await expect(auth.getUser('owner')).rejects.toMatchObject({
    code: 'auth/user-not-found',
  });
  expect((await db.doc('users/owner').get()).exists).toBe(false);
  expect((await db.collectionGroup('children').get()).size).toBe(0);
  expect((await db.doc('users/other').get()).exists).toBe(true);
  expect(
    (
      await admin.storage().bucket().file('products/owner/thumb/a.jpg').exists()
    )[0],
  ).toBe(false);
  expect(
    (await admin.storage().bucket().file('products/other/a.jpg').exists())[0],
  ).toBe(true);
  const tasks = await db
    .collection('account_deletion_requests')
    .doc(job.requestId)
    .collection('tasks')
    .get();
  expect(tasks.size).toBeGreaterThan(0); // Never silently promise provider erasure.
});

test('cleanup retries after Authentication removal without signing in, and lease excludes another worker', async () => {
  await user('owner');
  const token = receipt();
  const job = await service.request('owner', token);
  const ref = db.collection('account_deletion_requests').doc(job.requestId);
  const fail = {
    run: jest.fn().mockRejectedValue(new Error('secret provider failure')),
  };
  expect(await service.process(job.requestId, fail)).toBe(false);
  expect((await ref.get()).get('state')).toBe('retrying');
  expect(
    (await service.statusWithReceipt(job.requestId, token))
      .authenticationDeletedAt,
  ).not.toBeNull();
  await ref.update({
    nextAttemptAt: new Date(0),
    leaseOwner: 'other-worker',
    leaseUntil: new Date(Date.now() + 60000),
  });
  expect(await service.process(job.requestId, fail)).toBe(false);
  expect(fail.run).toHaveBeenCalledTimes(1);
  await ref.update({ leaseUntil: new Date(0) });
  expect(await drive(job.requestId)).toBe('requires_review');
});

test('active seller orders retain fulfilment while unrelated profile and ordinary listing disappear', async () => {
  await user('seller');
  await db.doc('products/p').set({ userId: 'seller', name: 'Coat' });
  await db
    .doc('orders/o')
    .set({
      userId: 'buyer',
      productId: 'p',
      status: 'shipped',
      email: 'buyer@example.test',
      shipping: { name: 'Buyer' },
      createdAt: new Date(),
    });
  const job = await service.request('seller', receipt());
  expect(await drive(job.requestId)).toBe('requires_review');
  const order = await db.doc('orders/o').get();
  expect(order.get('sellerId')).toBe('seller');
  expect(order.get('shipping.name')).toBe('Buyer');
  expect((await db.doc('products/p').get()).exists).toBe(false);
  expect((await db.doc('users/seller').get()).exists).toBe(false);
  const held = await db
    .doc(`account_deletion_requests/${job.requestId}/holds/o`)
    .get();
  expect(held.get('reason')).toBe('active_order');
});

test('new checkout after closure is rejected; started payment is held without cancellation', async () => {
  await user('buyer');
  await user('seller');
  await db
    .doc('products/p')
    .set({ userId: 'seller', name: 'Coat', number: 1, price: 10 });
  const contexts = new CheckoutContextRepository();
  const input = {
    buyerUid: 'buyer',
    sellerUid: 'seller',
    productId: 'p',
    productName: 'Coat',
    buyerEmail: 'buyer@example.test',
    metadata: { productAmount: '1000' },
  };
  const contextId = await contexts.start(input);
  const job = await service.request('seller', receipt());
  await expect(contexts.start(input)).rejects.toThrow('closed for deletion');
  await contexts.attachPayment(contextId, 'pi_test', 'cus_test');
  await contexts.recordProviderState(contextId, 'pi_test', 'succeeded', {
    firebaseUid: 'buyer',
    productId: 'p',
  });
  await contexts.recordProviderState(contextId, 'pi_test', 'cancelled', {
    firebaseUid: 'buyer',
    productId: 'p',
  });
  expect((await contexts.get(contextId))?.state).toBe('succeeded');
  await drive(job.requestId);
  expect((await db.doc('products/p').get()).exists).toBe(true);
  expect((await contexts.get(contextId))?.paymentIntentId).toBe('pi_test');
});

test('retention minimises personal fields, expires automatically and late updates do not restore them', async () => {
  await user('buyer');
  await db
    .doc('orders/o')
    .set({
      userId: 'buyer',
      sellerId: 'seller',
      status: 'delivered',
      completedAt: new Date('2011-01-01'),
      createdAt: new Date('2010-01-01'),
      email: 'buyer@example.test',
      shipping: { name: 'Buyer', address: 'Example street' },
      totalAmount: 1200,
      currency: 'GBP',
      paymentIntentId: 'pi_old',
      shipmentId: 's',
      productId: 'p',
    });
  await db
    .doc('shipments/s')
    .set({
      orderId: 'o',
      status: 'delivered',
      parcel: { name: 'Buyer' },
      labelUrl: 'secret-label',
      sendcloudId: 1,
    });
  await db
    .doc('order_payment_intents/pi_old')
    .set({ userId: 'buyer', orderId: 'o' });
  const token = receipt();
  const job = await service.request('buyer', token);
  expect(await drive(job.requestId)).toBe('requires_review');
  expect((await db.doc('orders/o').get()).get('shipping')).toBeUndefined();
  expect((await db.doc('shipments/s').get()).get('labelUrl')).toBeUndefined();
  expect((await db.doc('account_retained_orders/o').get()).exists).toBe(false);
  expect((await db.doc('order_payment_intents/pi_old').get()).exists).toBe(
    false,
  );
  await new OrderRepository().updateOrder('o', {
    email: 'rehydrated@example.test',
  });
  await new ShipmentRepository().updateShipment('s', {
    labelUrl: 'rehydrated-secret',
  });
  expect((await db.doc('orders/o').get()).get('email')).toBeUndefined();
  expect((await db.doc('shipments/s').get()).get('labelUrl')).toBeUndefined();
  const tasks = await db
    .collection('account_deletion_requests')
    .doc(job.requestId)
    .collection('tasks')
    .get();
  for (const task of tasks.docs)
    await task.ref.update({
      status: 'resolved',
      resolvedAt: new Date(),
      resolutionCode:
        task.get('kind') === 'exports_lifecycle_review'
          ? 'inventory_verified'
          : 'recipient_erasure_confirmed',
      reviewer: 'test-reviewer',
      evidenceReference: 'test-only-evidence',
    });
  expect(await drive(job.requestId)).toBe('completed');
  expect(
    (await service.statusWithReceipt(job.requestId, token)).completedAt,
  ).not.toBeNull();
  await auth.createUser({ uid: 'fresh-buyer', email: 'buyer@example.test' });
  expect(await new OrderRepository().getOrdersByUserId('fresh-buyer')).toEqual(
    [],
  );
});

test('unexpired evidence is private, minimal and remains distinct from live-data erasure', async () => {
  await user('buyer');
  await db
    .doc('orders/o')
    .set({
      userId: 'buyer',
      sellerId: 'seller',
      status: 'delivered',
      completedAt: new Date(),
      createdAt: new Date(),
      email: 'buyer@example.test',
      shipping: { name: 'Buyer' },
      totalAmount: 1200,
      currency: 'GBP',
      paymentIntentId: 'pi_current',
    });
  const job = await service.request('buyer', receipt());
  await drive(job.requestId);
  const record = (await db.doc('account_retained_orders/o').get()).data()!;
  expect(record.evidence.userId).toBe('buyer');
  expect(record.financial.totalAmount).toBe(1200);
  expect(record.evidence.email).toBeUndefined();
  expect(record.evidence.shipping).toBeUndefined();
  expect(record.financial.email).toBeUndefined();
  const tasks = await db
    .collection('account_deletion_requests')
    .doc(job.requestId)
    .collection('tasks')
    .get();
  for (const task of tasks.docs)
    await task.ref.update({
      status: 'resolved',
      resolvedAt: new Date(),
      resolutionCode:
        task.get('kind') === 'exports_lifecycle_review'
          ? 'inventory_verified'
          : 'recipient_erasure_confirmed',
      reviewer: 'test-reviewer',
      evidenceReference: 'test-only-evidence',
    });
  expect(await drive(job.requestId)).toBe('retained');
});

test('late resumable-upload completion is swept without touching another owner', async () => {
  await admin.storage().bucket().file('products/closed/late.jpg').save('late test upload');
  await admin.storage().bucket().file('products/other/keep.jpg').save('other');
  expect(await sweepOwnedMedia(admin.storage(), 'closed')).toBe(true);
  expect(await sweepOwnedMedia(admin.storage(), 'closed')).toBe(false);
  expect((await admin.storage().bucket().file('products/other/keep.jpg').exists())[0]).toBe(true);
});
