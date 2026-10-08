import { randomBytes } from 'crypto';
import { admin, firestore as db } from '../../../shared/config/firebaseConfig';
import { AccountCleanup } from '../cleanup';
import { DeletionService } from '../service';
import { loadDeletionPolicy } from '../config';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';

const policy = loadDeletionPolicy();
const service = new DeletionService(db, admin.auth());
const old = new Date('2010-01-01');
async function request(uid: string) {
  await admin.auth().createUser({ uid });
  return service.request(uid, randomBytes(32).toString('base64url'));
}
async function drive(id: string, now = new Date()) {
  for (let i = 0; i < 80; i++) {
    const result = await new AccountCleanup(db, admin.storage(), policy).run(
      (await db.doc(`account_deletion_requests/${id}`).get()).get('uid'),
      id,
      now,
    );
    if (!result.holds.includes('cleanup_in_progress')) return result;
  }
  throw new Error('Cleanup did not finish its pass');
}
async function resolveTasks(id: string) {
  for (const task of (
    await db.collection(`account_deletion_requests/${id}/tasks`).get()
  ).docs) {
    const codes: Record<string, string> = {
      exports_lifecycle_review: 'inventory_verified',
      financial_date_review: 'terminal_date_confirmed',
      provider: 'recipient_erasure_confirmed',
      ambiguous_media: 'asset_erasure_confirmed',
    };
    await task.ref.update({
      status: 'resolved',
      resolvedAt: new Date(),
      reviewer: 'test-reviewer',
      evidenceReference: 'test-only-evidence',
      resolutionCode: codes[task.get('kind')],
    });
  }
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
});
afterAll(async () => {
  await db.terminate();
});

test('resolving a missing-date task cannot bypass actual order minimisation', async () => {
  await db.doc('orders/o').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'delivered',
    completedAt: old,
    email: 'private@example.test',
    shipping: { name: 'Buyer' },
  });
  const job = await request('buyer');
  await drive(job.requestId);
  await resolveTasks(job.requestId);
  expect((await drive(job.requestId)).liveErased).toBe(false);
  expect((await db.doc('orders/o').get()).get('email')).toBe(
    'private@example.test',
  );
  expect(
    (
      await db.doc(`account_deletion_requests/${job.requestId}/holds/o`).get()
    ).get('reason'),
  ).toBe('financial_date_unverified');
  await db.doc('orders/o').update({ createdAt: old });
  expect((await drive(job.requestId)).holds).toEqual([]);
  expect((await db.doc('orders/o').get()).get('email')).toBeUndefined();
});

test('parcel cancellation does not prove captured payment settlement', async () => {
  await db.doc('orders/o').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'cancelled',
    paymentStatus: 'succeeded',
    completedAt: old,
    createdAt: old,
    shipping: { name: 'Buyer' },
  });
  const job = await request('buyer');
  await drive(job.requestId);
  await resolveTasks(job.requestId);
  expect((await drive(job.requestId)).liveErased).toBe(false);
  expect((await db.doc('orders/o').get()).get('shipping.name')).toBe('Buyer');
  await db.doc('orders/o').update({
    financialReconciliation: {
      status: 'settled',
      reviewedAt: new Date(),
      reviewer: 'test-reviewer',
      evidenceReference: 'test-settlement',
    },
  });
  expect((await drive(job.requestId)).holds).toEqual([]);
});

test('both deleting participants receive a shared checkout outcome without permanent holds', async () => {
  await db.doc('account_checkout_contexts/c').set({
    buyerUid: 'buyer',
    sellerUid: 'seller',
    productId: 'p',
    customerId: 'cus_buyer',
    state: 'open',
  });
  const buyer = await request('buyer');
  const seller = await request('seller');
  await drive(buyer.requestId);
  await drive(seller.requestId);
  const sellerTasks = await db
    .collection(`account_deletion_requests/${seller.requestId}/tasks`)
    .get();
  expect(
    sellerTasks.docs.some((task) => task.get('provider') === 'stripe'),
  ).toBe(false);
  await db.doc('account_checkout_contexts/c').update({ state: 'cancelled' });
  await drive(buyer.requestId);
  expect((await db.doc('account_checkout_contexts/c').get()).exists).toBe(
    false,
  );
  await resolveTasks(buyer.requestId);
  await resolveTasks(seller.requestId);
  expect((await drive(seller.requestId)).holds).toEqual([]);
  expect((await drive(buyer.requestId)).holds).toEqual([]);
  expect(
    (
      await db
        .collection(`account_deletion_requests/${seller.requestId}/holds`)
        .get()
    ).empty,
  ).toBe(true);
});

test('pending listing is reduced to fulfilment fields and ambiguous media is reviewed', async () => {
  await db.doc('products/p').set({
    userId: 'seller',
    name: 'Personal text',
    number: 1,
    price: 10,
    postageSize: 'small',
    charityId: 'charity',
    description: 'Private text',
    product_images: ['https://example.test/legacy.jpg?token=secret'],
  });
  await db.doc('account_checkout_contexts/c').set({
    buyerUid: 'buyer',
    sellerUid: 'seller',
    productId: 'p',
    state: 'open',
  });
  const job = await request('seller');
  await drive(job.requestId);
  expect((await db.doc('products/p').get()).data()).toEqual({
    userId: 'seller',
    name: 'Removed listing',
    number: 1,
    price: 10,
    postageSize: 'small',
    charityId: 'charity',
    deletionMinimised: true,
  });
  const tasks = await db
    .collection(`account_deletion_requests/${job.requestId}/tasks`)
    .get();
  expect(
    tasks.docs.some((task) => task.get('kind') === 'ambiguous_media'),
  ).toBe(true);
  expect(JSON.stringify(tasks.docs.map((doc) => doc.data()))).not.toContain(
    'token=secret',
  );
});

test('expiry removes live identifiers and amounts; later counterparty closure removes the minimal shell', async () => {
  await db.doc('orders/o').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'delivered',
    createdAt: old,
    completedAt: old,
    productId: 'p',
    shipmentId: 's',
    paymentIntentId: 'pi_old',
    totalAmount: 1200,
    currency: 'GBP',
    email: 'buyer@example.test',
  });
  await db.doc('shipments/s').set({
    orderId: 'o',
    parcel: { name: 'Buyer' },
    labelUrl: 'private-label',
  });
  await db.doc('shipments/s/children/private').set({ name: 'Buyer' });
  await db.doc('order_payment_intents/pi_old').set({ orderId: 'o' });
  const buyer = await request('buyer');
  await drive(buyer.requestId);
  expect((await db.doc('orders/o').get()).data()).toEqual({
    sellerId: 'seller',
    status: 'delivered',
    deletionMinimised: true,
    retentionExpired: true,
  });
  expect((await db.doc('shipments/s').get()).exists).toBe(false);
  expect((await db.doc('shipments/s/children/private').get()).exists).toBe(
    false,
  );
  expect((await db.doc('account_retained_orders/o').get()).exists).toBe(false);
  expect((await db.doc('order_payment_intents/pi_old').get()).exists).toBe(
    false,
  );
  const seller = await request('seller');
  await drive(seller.requestId);
  await resolveTasks(seller.requestId);
  expect((await drive(seller.requestId)).holds).toEqual([]);
  expect((await db.doc('orders/o').get()).exists).toBe(false);
});

test('a later authorised hold stops expiry; releasing it permits the existing expiry schedule', async () => {
  await db.doc('orders/o').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'delivered',
    createdAt: new Date(),
    completedAt: new Date(),
    paymentIntentId: 'pi_current',
    totalAmount: 1200,
  });
  const buyer = await request('buyer');
  await drive(buyer.requestId);
  await resolveTasks(buyer.requestId);
  await db.doc('orders/o').update({ disputeOpen: true });
  expect(
    (await drive(buyer.requestId, new Date('2040-01-01'))).liveErased,
  ).toBe(false);
  expect((await db.doc('account_retained_orders/o').get()).exists).toBe(true);
  await db.doc('orders/o').update({ disputeOpen: false });
  expect((await drive(buyer.requestId, new Date('2040-01-01'))).holds).toEqual(
    [],
  );
  expect((await db.doc('account_retained_orders/o').get()).exists).toBe(false);
});

test('likes cleanup crosses page boundaries, removes seller references and only decrements once', async () => {
  const batch = db.batch();
  for (let i = 0; i < 55; i++) {
    batch.set(db.doc(`products/p${i}`), { userId: 'other', likes: 2 });
    batch.set(db.doc(`user_likes/owner_p${i}`), {
      userId: 'owner',
      productId: `p${i}`,
    });
    batch.set(db.doc(`user_likes/other_p${i}`), {
      userId: 'other',
      productId: `p${i}`,
    });
  }
  batch.set(db.doc('products/owned'), { userId: 'owner', likes: 1 });
  batch.set(db.doc('user_likes/other_owned'), {
    userId: 'other',
    productId: 'owned',
  });
  batch.set(db.doc('user_likes/owner_p0/private/orphan'), {
    personal: 'nested data',
  });
  await batch.commit();
  const job = await request('owner');
  await drive(job.requestId);
  expect(
    (await db.collection('user_likes').where('userId', '==', 'owner').get())
      .empty,
  ).toBe(true);
  expect((await db.doc('user_likes/other_owned').get()).exists).toBe(false);
  expect(
    (await db.doc('user_likes/owner_p0/private/orphan').get()).exists,
  ).toBe(false);
  expect((await db.doc('user_likes/other_p0').get()).exists).toBe(true);
  expect((await db.doc('products/p0').get()).get('likes')).toBe(1);
  expect((await db.doc('products/p54').get()).get('likes')).toBe(1);
  // Replay a persisted page after a worker interruption: no double subtraction.
  await db
    .doc(`account_deletion_requests/${job.requestId}/cleanup/state`)
    .set({ phase: 'erase_likes' });
  await drive(job.requestId);
  expect((await db.doc('products/p0').get()).get('likes')).toBe(1);
});

test('profile aliases are discovered and conflicting ownership is held for review', async () => {
  await db.doc('users/legacy').set({
    firebaseUid: 'owner',
    profileImageUrl: 'https://example.test/photo.jpg?token=private',
  });
  for (let i = 0; i < 51; i++) {
    await db
      .doc(`users/conflict${i}`)
      .set({ id: 'owner', firebaseUid: 'someone-else' });
  }
  const job = await request('owner');
  const result = await drive(job.requestId);
  expect(result.liveErased).toBe(false);
  expect((await db.doc('users/legacy').get()).exists).toBe(false);
  expect((await db.doc('users/conflict50').get()).exists).toBe(true);
  const tasks = (
    await db
      .collection(`account_deletion_requests/${job.requestId}/tasks`)
      .get()
  ).docs;
  expect(
    tasks.filter((task) => task.get('kind') === 'ownership_review'),
  ).toHaveLength(51);
  expect(tasks.some((task) => task.get('kind') === 'ambiguous_media')).toBe(
    true,
  );
  expect(JSON.stringify(tasks.map((task) => task.data()))).not.toContain(
    'token=private',
  );
});

test('a buyer dispute blocks terminal minimisation until resolved', async () => {
  await db.doc('orders/disputed').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'delivered',
    createdAt: new Date(),
    completedAt: new Date(),
    buyerDisputeStatus: 'under_review',
    buyerDisputeReason: 'item_issue',
    buyerDisputeMessage: 'Evidence needed for support',
    email: 'buyer@example.test',
  });
  const job = await request('buyer');
  await drive(job.requestId);
  await resolveTasks(job.requestId);
  expect((await drive(job.requestId)).liveErased).toBe(false);
  expect(
    (await db.doc('orders/disputed').get()).get('buyerDisputeMessage'),
  ).toBe('Evidence needed for support');
  expect((await db.doc('account_retained_orders/disputed').get()).exists).toBe(
    false,
  );
  await db.doc('orders/disputed').update({ buyerDisputeStatus: 'resolved' });
  await drive(job.requestId);
  expect(
    (await db.doc('orders/disputed').get()).get('buyerDisputeMessage'),
  ).toBeUndefined();
  expect((await db.doc('orders/disputed').get()).get('email')).toBeUndefined();
  expect((await db.doc('account_retained_orders/disputed').get()).exists).toBe(
    true,
  );
  const emailTasks = (
    await db
      .collection(`account_deletion_requests/${job.requestId}/tasks`)
      .get()
  ).docs;
  expect(
    emailTasks.some((task) => task.get('target') === 'resend-order:disputed'),
  ).toBe(true);
});

test('in-flight shipment claims prevent erasure until the provider result is persisted', async () => {
  await db.doc('orders/parcel').set({
    userId: 'buyer',
    sellerId: 'seller',
    status: 'paid',
    paymentStatus: 'succeeded',
    createdAt: old,
    shipping: { name: 'Buyer' },
  });
  const shipments = new ShipmentRepository();
  const claim = await shipments.beginShipmentCreation('parcel');
  await expect(shipments.beginShipmentCreation('parcel')).rejects.toThrow(
    'reconciliation',
  );
  // A terminal update cannot make an uncertain provider call safe to erase.
  await db
    .doc('orders/parcel')
    .update({ status: 'delivered', completedAt: old });
  const job = await request('buyer');
  await drive(job.requestId);
  expect((await db.doc('orders/parcel').get()).get('shipping.name')).toBe(
    'Buyer',
  );
  expect(
    (
      await db
        .doc(`account_deletion_requests/${job.requestId}/holds/parcel`)
        .get()
    ).exists,
  ).toBe(true);
  const shipment = await shipments.createShipment(
    {
      orderId: 'parcel',
      sendcloudId: 123,
      status: 'announced',
      parcel: { name: 'Buyer' },
    } as any,
    claim.attemptId,
  );
  expect(
    (await db.doc('orders/parcel').get()).get('shipmentCreationPending'),
  ).toBeUndefined();
  await drive(job.requestId);
  expect((await db.doc('orders/parcel').get()).get('shipping')).toBeUndefined();
  expect((await db.doc(`shipments/${shipment.id}`).get()).exists).toBe(false);
  await expect(shipments.beginShipmentCreation('parcel')).rejects.toThrow(
    'no longer available',
  );
  await expect(
    shipments.createShipment({ orderId: 'parcel' } as any, claim.attemptId),
  ).rejects.toThrow('reconciliation');
});
