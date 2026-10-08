import { randomBytes } from 'crypto';
import { admin, firestore as db } from '../../../shared/config/firebaseConfig';
import { DeletionService } from '../service';
import { loadDeletionPolicy } from '../config';

const auth = admin.auth();
const service = new DeletionService(db, auth);
async function resolveEmailReview(requestId: string) {
  await db
    .doc(`account_deletion_requests/${requestId}/tasks/resend-account-review`)
    .update({
      status: 'resolved',
      resolvedAt: new Date(),
      reviewer: 'test-reviewer',
      evidenceReference: 'test-email-review',
      resolutionCode: 'recipient_erasure_confirmed',
    });
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

test('a saved secret recovers a lost acceptance response after Authentication is gone', async () => {
  await auth.createUser({ uid: 'receipt-owner' });
  const token = randomBytes(32).toString('base64url');
  const accepted = await service.request('receipt-owner', token);
  await service.process(accepted.requestId, {
    run: async () => ({ liveErased: true, holds: [] }),
  });
  await expect(auth.getUser('receipt-owner')).rejects.toMatchObject({
    code: 'auth/user-not-found',
  });
  const recovered = await service.statusWithReceipt(undefined, token);
  expect(recovered.requestId).toBe(accepted.requestId);
  expect(recovered.state).toBe('requires_review');
  expect(recovered.liveDataErasedAt).toBeNull();
  await expect(
    service.statusWithReceipt(undefined, randomBytes(32).toString('base64url')),
  ).rejects.toThrow('REQUEST_NOT_FOUND');
});

test('private audit can expire without shortening the advertised receipt lifetime', async () => {
  await auth.createUser({ uid: 'receipt-owner' });
  const token = randomBytes(32).toString('base64url');
  const accepted = await service.request('receipt-owner', token);
  await resolveEmailReview(accepted.requestId);
  await service.process(accepted.requestId, {
    run: async () => ({ liveErased: true, holds: [] }),
  });
  const job = db.doc(`account_deletion_requests/${accepted.requestId}`);
  await job.update({ auditExpiresAt: new Date(0) });
  await job
    .collection('private')
    .doc('case')
    .set({ email: 'private@example.test' });
  expect(await service.expireCompletedAudit(accepted.requestId)).toBe(true);
  expect((await job.get()).exists).toBe(false);
  expect((await job.collection('private').get()).empty).toBe(true);
  expect(
    (await db.doc('account_deletion_guards/receipt-owner').get()).exists,
  ).toBe(false);
  const receipt = await db
    .doc(`account_deletion_receipts/${accepted.requestId}`)
    .get();
  expect(receipt.exists).toBe(true);
  expect(receipt.get('uid')).toBeUndefined();
  expect(JSON.stringify(receipt.data())).not.toContain('receipt-owner');
  expect(
    (await service.statusWithReceipt(undefined, token)).statusTokenExpiresAt,
  ).toBe(accepted.statusTokenExpiresAt);
  expect(
    (await service.statusWithReceipt(accepted.requestId, token)).state,
  ).toBe('completed');
  await receipt.ref.update({ statusTokenExpiresAt: new Date(0) });
  await expect(service.statusWithReceipt(undefined, token)).rejects.toThrow(
    'REQUEST_NOT_FOUND',
  );
  expect(await service.expireReceipts()).toBe(1);
  expect((await receipt.ref.get()).exists).toBe(false);
});

test('a changed retention period cannot silently reuse an approved policy version', async () => {
  await auth.createUser({ uid: 'receipt-owner' });
  const accepted = await service.request(
    'receipt-owner',
    randomBytes(32).toString('base64url'),
  );
  const policy = loadDeletionPolicy();
  const changed = new DeletionService(db, auth, () => ({
    ...policy,
    financialYears: policy.financialYears + 1,
  }));
  const cleanup = { run: jest.fn() };
  await expect(changed.process(accepted.requestId, cleanup)).rejects.toThrow(
    'POLICY_VERSION_REVIEW_REQUIRED',
  );
  expect(cleanup.run).not.toHaveBeenCalled();
  expect((await auth.getUser('receipt-owner')).disabled).toBe(false);
});
