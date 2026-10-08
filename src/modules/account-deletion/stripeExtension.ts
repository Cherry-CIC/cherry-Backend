import { createHash, randomUUID } from 'crypto';
import {
  DocumentReference,
  FieldValue,
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

export const STRIPE_EXTENSION_TASK = 'stripe-extension-customer';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const reviewDate = (value: unknown) =>
  value instanceof Timestamp ? value.toDate() : value;

/** This authorises local tree erasure only, never a Stripe Customer API deletion. */
export function extensionReviewApproved(task: any): boolean {
  const date = reviewDate(task?.resolvedAt);
  return (
    task?.kind === 'stripe_extension_review' &&
    task.status === 'resolved' &&
    task.resolutionCode === 'customer_tree_erasure_approved' &&
    date instanceof Date &&
    Number.isFinite(date.getTime()) &&
    typeof task.reviewer === 'string' &&
    task.reviewer.trim().length >= 3 &&
    typeof task.evidenceReference === 'string' &&
    task.evidenceReference.trim().length >= 8 &&
    task.customerOwnershipVerified === true &&
    task.financialEvidencePreserved === true &&
    task.supportContinuityVerified === true &&
    task.writersStoppedAndDrained === true &&
    task.approvedReviewGeneration === task.reviewGeneration &&
    typeof task.reviewGeneration === 'string' &&
    task.approvedMappingHash === task.mappingHash &&
    typeof task.mappingHash === 'string' &&
    task.approvedConfigurationEvidence === task.configurationEvidence &&
    typeof task.configurationEvidence === 'string' &&
    typeof task.writerEvidenceReference === 'string' &&
    task.writerEvidenceReference.trim().length >= 8
  );
}

export function assertExtensionApprovalScope(task: any, input: any): void {
  if (
    typeof task?.reviewGeneration !== 'string' ||
    input.expectedReviewGeneration !== task.reviewGeneration ||
    input.expectedMappingHash !== task.mappingHash ||
    input.expectedConfigurationEvidence !== task.configurationEvidence
  )
    throw new Error(
      'Extension review changed; obtain fresh evidence and approval',
    );
}

/** Capture before Auth removal, without retaining checkout secrets or provider payloads. */
export async function captureExtensionCustomer(
  db: Firestore,
  uid: string,
  requestId: string,
  now: Date,
  assertLease: () => Promise<void> = async () => undefined,
): Promise<boolean> {
  const customer = db.collection('customers').doc(uid);
  const [root, children] = await Promise.all([
    customer.get(),
    customer.listCollections(),
  ]);
  if (!root.exists && children.length === 0) return false;
  const stripeId = root.get('stripeId');
  const candidate =
    typeof stripeId === 'string' && /^cus_[A-Za-z0-9]+$/.test(stripeId)
      ? stripeId
      : null;
  const mappingHash = digest(candidate || 'mapping-unavailable');
  const job = db.collection('account_deletion_requests').doc(requestId);
  const taskRef = job.collection('tasks').doc(STRIPE_EXTENSION_TASK);
  const stateRef = job.collection('cleanup').doc('stripe-extension');
  await assertLease();
  await db.runTransaction(async (tx) => {
    const [task, state, request] = await Promise.all([
      tx.get(taskRef),
      tx.get(stateRef),
      tx.get(job),
    ]);
    if (!request.exists) throw new Error('Deletion context is missing');
    const providerRef = candidate
      ? job.collection('tasks').doc(digest(`provider:stripe:${candidate}`))
      : null;
    const provider = providerRef ? await tx.get(providerRef) : null;
    // Mapping candidates are unverified: legacy rules may have allowed user edits.
    if (providerRef && !provider?.exists)
      tx.create(providerRef, {
        kind: 'provider',
        provider: 'stripe',
        target: `stripe:${candidate}`,
        reason: 'extension_customer_ownership_review',
        status: 'pending',
        createdAt: now,
        reviewAt: now,
      });
    const configurationEvidence =
      request.get('extensionConfigurationEvidence') || 'unverified';
    const changed =
      task.exists &&
      (task.get('mappingHash') !== mappingHash ||
        task.get('configurationEvidence') !== configurationEvidence);
    const reappeared =
      !!state.get('erasedAt') || !!state.get('erasureAttemptedAt');
    if (!task.exists || changed || reappeared) {
      tx.set(taskRef, {
        kind: 'stripe_extension_review',
        target: customer.path,
        status: 'pending',
        reason: reappeared
          ? 'extension_data_reappeared'
          : changed
            ? 'extension_mapping_changed'
            : 'extension_financial_and_writer_review',
        mappingHash,
        reviewGeneration: randomUUID(),
        createdAt: task.get('createdAt') || now,
        reviewAt: now,
        configurationEvidence,
      });
      tx.set(
        stateRef,
        {
          erasedAt: FieldValue.delete(),
          erasureAttemptedAt: FieldValue.delete(),
          reviewRequiredAt: now,
        },
        { merge: true },
      );
    }
  });
  return true;
}

/** The caller must hold the job lease. Reappearing data invalidates, rather than reuses, approval. */
export async function eraseReviewedExtensionCustomer(
  db: Firestore,
  uid: string,
  requestId: string,
  now: Date,
  assertLease: () => Promise<void>,
): Promise<boolean> {
  const present = await captureExtensionCustomer(
    db,
    uid,
    requestId,
    now,
    assertLease,
  );
  if (!present) return true;
  const job = db.collection('account_deletion_requests').doc(requestId);
  const task = await job.collection('tasks').doc(STRIPE_EXTENSION_TASK).get();
  if (!extensionReviewApproved(task.data())) return false;
  const customer = db.collection('customers').doc(uid);
  await assertLease();
  await db.runTransaction(async (tx) => {
    const latest = await tx.get(task.ref);
    if (
      !extensionReviewApproved(latest.data()) ||
      latest.get('reviewGeneration') !== task.get('reviewGeneration')
    )
      throw new Error('Extension review changed');
    // A failed or interrupted erase never authorises another pass over possibly
    // new financial data. Remaining data requires a fresh review generation.
    tx.set(job.collection('cleanup').doc('stripe-extension'), {
      erasureAttemptedAt: now,
    });
  });
  const writer = db.bulkWriter({
    throttling: { initialOpsPerSecond: 50, maxOpsPerSecond: 100 },
  });
  writer.onWriteError((error) => error.failedAttempts < 3);
  try {
    await db.recursiveDelete(customer, writer);
  } finally {
    await writer.close();
  }
  await assertLease();
  await job
    .collection('cleanup')
    .doc('stripe-extension')
    .set({ erasedAt: now });
  // If a supposedly drained writer recreated anything, preserve it for a fresh
  // financial review. Repeated deletion must not replay extension triggers.
  return !(await captureExtensionCustomer(
    db,
    uid,
    requestId,
    now,
    assertLease,
  ));
}

/** Called during completed-job audit, before the suppression guard may expire. */
export async function reopenForExtensionData(
  db: Firestore,
  job: DocumentReference,
  uid: string,
  now: Date,
): Promise<boolean> {
  if (!(await captureExtensionCustomer(db, uid, job.id, now))) return false;
  await db.runTransaction(async (tx) => {
    const current = await tx.get(job);
    if (current.get('state') !== 'completed') return;
    tx.update(job, {
      state: 'requires_review',
      holds: ['extension_data_reappeared'],
      nextAttemptAt: now,
      updatedAt: now,
      completedAt: FieldValue.delete(),
      liveDataErasedAt: FieldValue.delete(),
      auditExpiresAt: FieldValue.delete(),
    });
    // Even legacy jobs without an erasedAt marker need a fresh review.
    tx.set(
      job.collection('tasks').doc(STRIPE_EXTENSION_TASK),
      {
        status: 'pending',
        reason: 'extension_data_reappeared',
        reviewAt: now,
        reviewGeneration: randomUUID(),
      },
      { merge: true },
    );
  });
  return true;
}
