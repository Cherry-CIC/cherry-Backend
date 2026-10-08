import { randomBytes } from 'crypto';
import { admin, firestore as db } from '../../../shared/config/firebaseConfig';
import { DeletionService } from '../service';
import { validResolution } from '../cleanup';
import {
  STRIPE_EXTENSION_TASK,
  captureExtensionCustomer,
  eraseReviewedExtensionCustomer,
  extensionReviewApproved,
  assertExtensionApprovalScope,
} from '../stripeExtension';

const auth = admin.auth();
const service = new DeletionService(db, auth);
const noLease = async () => undefined;
const emptyCleanup = { run: async () => ({ liveErased: true, holds: [] }) };
async function request() {
  await auth.createUser({ uid: 'owner' });
  return service.request('owner', randomBytes(32).toString('base64url'));
}
const taskRef = (id: string) =>
  db.doc(`account_deletion_requests/${id}/tasks/${STRIPE_EXTENSION_TASK}`);
async function approve(id: string) {
  const ref = taskRef(id);
  const task = (await ref.get()).data()!;
  const input = {
    expectedReviewGeneration: task.reviewGeneration,
    expectedMappingHash: task.mappingHash,
    expectedConfigurationEvidence: task.configurationEvidence,
  };
  assertExtensionApprovalScope(task, input);
  await ref.update({
    status: 'resolved',
    resolvedAt: new Date(),
    reviewer: 'test-reviewer',
    evidenceReference: 'test-financial-case',
    resolutionCode: 'customer_tree_erasure_approved',
    customerOwnershipVerified: true,
    financialEvidencePreserved: true,
    supportContinuityVerified: true,
    writersStoppedAndDrained: true,
    writerEvidenceReference: 'test-drained-writers',
    approvedReviewGeneration: input.expectedReviewGeneration,
    approvedMappingHash: input.expectedMappingHash,
    approvedConfigurationEvidence: input.expectedConfigurationEvidence,
  });
  return input;
}
async function resolveProviders(id: string) {
  for (const task of (
    await db.collection(`account_deletion_requests/${id}/tasks`).get()
  ).docs) {
    if (task.get('kind') !== 'provider') continue;
    await task.ref.update({
      status: 'resolved',
      resolvedAt: new Date(),
      reviewer: 'test-reviewer',
      evidenceReference: 'test-provider-case',
      resolutionCode: 'recipient_erasure_confirmed',
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
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  await db.terminate();
});

test('mapping candidates are durably captured before Auth removal without copying payloads or secrets', async () => {
  await db
    .doc('customers/owner')
    .set({ stripeId: 'cus_first', email: 'private@example.test' });
  await db
    .doc('customers/owner/checkout_sessions/c')
    .set({ paymentIntentClientSecret: 'not-for-audit' });
  const job = await request();
  const originalDelete = auth.deleteUser.bind(auth);
  jest.spyOn(auth, 'deleteUser').mockImplementation(async (uid) => {
    expect((await taskRef(job.requestId).get()).get('status')).toBe('pending');
    const tasks = await db
      .collection(`account_deletion_requests/${job.requestId}/tasks`)
      .get();
    const saved = JSON.stringify(tasks.docs.map((task) => task.data()));
    expect(saved).toContain('stripe:cus_first');
    expect(saved).not.toContain('private@example.test');
    expect(saved).not.toContain('not-for-audit');
    return originalDelete(uid);
  });
  await service.process(job.requestId, emptyCleanup);
  expect(
    (await db.doc('customers/owner/checkout_sessions/c').get()).exists,
  ).toBe(true);
  expect(
    (await db.doc(`account_deletion_requests/${job.requestId}`).get()).get(
      'state',
    ),
  ).not.toBe('completed');
});

test('generic provider acknowledgement cannot approve extension financial-tree erasure', async () => {
  const job = await request();
  await db.doc('customers/owner').set({ stripeId: 'cus_first' });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  await taskRef(job.requestId).update({
    status: 'resolved',
    resolvedAt: new Date(),
    reviewer: 'test-reviewer',
    evidenceReference: 'test-case',
    resolutionCode: 'independent_controller_retention_confirmed',
  });
  expect(validResolution((await taskRef(job.requestId).get()).data())).toBe(
    false,
  );
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(false);
  expect((await db.doc('customers/owner').get()).exists).toBe(true);
});

test('reviewed cleanup removes over 450 descendants beneath a missing parent and preserves another owner', async () => {
  const job = await request();
  for (let start = 0; start < 510; start += 100) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 100, 510); i++)
      batch.set(db.doc(`customers/owner/payments/missing/children/${i}`), {
        amount: i,
        secret: 'test-only',
      });
    await batch.commit();
  }
  await db.doc('customers/other/payments/p').set({ amount: 999 });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(false);
  await approve(job.requestId);
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(true);
  expect((await db.collectionGroup('children').get()).empty).toBe(true);
  expect((await db.doc('customers/other/payments/p').get()).get('amount')).toBe(
    999,
  );
});

test('changed and then missing mappings invalidate prepared approval files and preserve candidates', async () => {
  const job = await request();
  await db.doc('customers/owner').set({ stripeId: 'cus_first' });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  const oldInput = await approve(job.requestId);
  await db.doc('customers/owner').update({ stripeId: 'cus_second' });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  const changed = (await taskRef(job.requestId).get()).data();
  expect(() => assertExtensionApprovalScope(changed, oldInput)).toThrow(
    'Extension review changed',
  );
  expect(extensionReviewApproved(changed)).toBe(false);
  const tasks = await db
    .collection(`account_deletion_requests/${job.requestId}/tasks`)
    .get();
  expect(tasks.docs.map((task) => task.get('target'))).toEqual(
    expect.arrayContaining(['stripe:cus_first', 'stripe:cus_second']),
  );
  const secondInput = await approve(job.requestId);
  await db.doc('customers/owner/payments/p').set({ amount: 100 });
  await db.doc('customers/owner').delete();
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  const missing = (await taskRef(job.requestId).get()).data();
  expect(() => assertExtensionApprovalScope(missing, secondInput)).toThrow(
    'Extension review changed',
  );
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(false);
});

test('failed erasure records an attempt and requires fresh review before any retry', async () => {
  const job = await request();
  await db.doc('customers/owner').set({ stripeId: 'cus_first' });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  await approve(job.requestId);
  const failure = jest
    .spyOn(db, 'recursiveDelete')
    .mockRejectedValueOnce(new Error('simulated interruption'));
  await expect(
    eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).rejects.toThrow('simulated interruption');
  expect(
    (
      await db
        .doc(
          `account_deletion_requests/${job.requestId}/cleanup/stripe-extension`,
        )
        .get()
    ).get('erasureAttemptedAt'),
  ).toBeDefined();
  failure.mockRestore();
  await db.doc('customers/owner/payments/new').set({ amount: 123 });
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(false);
  expect((await db.doc('customers/owner/payments/new').get()).exists).toBe(
    true,
  );
  await approve(job.requestId);
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(true);
});

test('late recreation reopens a completed job and preserves new data instead of reusing approval', async () => {
  const job = await request();
  await db.doc('customers/owner').set({ stripeId: 'cus_first' });
  await captureExtensionCustomer(db, 'owner', job.requestId, new Date());
  await approve(job.requestId);
  await eraseReviewedExtensionCustomer(
    db,
    'owner',
    job.requestId,
    new Date(),
    noLease,
  );
  await resolveProviders(job.requestId);
  await service.process(job.requestId, emptyCleanup);
  const ref = db.doc(`account_deletion_requests/${job.requestId}`);
  expect((await ref.get()).get('state')).toBe('completed');
  await ref.update({ auditExpiresAt: new Date(0) });
  await db.doc('customers/owner/payments/late').set({ amount: 555 });
  expect(await service.expireCompletedAudit(job.requestId)).toBe(false);
  expect((await ref.get()).get('state')).toBe('requires_review');
  expect((await ref.get()).get('completedAt')).toBeUndefined();
  expect((await db.doc('account_deletion_guards/owner').get()).exists).toBe(
    true,
  );
  expect(
    await eraseReviewedExtensionCustomer(
      db,
      'owner',
      job.requestId,
      new Date(),
      noLease,
    ),
  ).toBe(false);
  expect((await db.doc('customers/owner/payments/late').get()).exists).toBe(
    true,
  );
});

test('changed deployment evidence stops processing and prevents completed audit removal', async () => {
  const job = await request();
  const ref = db.doc(`account_deletion_requests/${job.requestId}`);
  const original = (await ref.get()).get('extensionConfigurationEvidence');
  await ref.update({ extensionConfigurationEvidence: 'changed-evidence' });
  await expect(service.process(job.requestId, emptyCleanup)).rejects.toThrow(
    'EXTENSION_CONFIGURATION_REVIEW_REQUIRED',
  );
  expect((await auth.getUser('owner')).disabled).toBe(false);
  await ref.update({ extensionConfigurationEvidence: original });
  await resolveProviders(job.requestId);
  await service.process(job.requestId, emptyCleanup);
  await ref.update({
    extensionConfigurationEvidence: 'changed-evidence',
    auditExpiresAt: new Date(0),
  });
  expect(await service.expireCompletedAudit(job.requestId)).toBe(false);
  expect((await ref.get()).get('state')).toBe('requires_review');
  expect((await db.doc('account_deletion_guards/owner').get()).exists).toBe(
    true,
  );
});
