import 'dotenv/config';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { admin, firestore } from '../shared/config/firebaseConfig';
import {
  AccountCleanup,
  asDate,
  validResolution,
  sweepOwnedMedia,
} from '../modules/account-deletion/cleanup';
import { DeletionService } from '../modules/account-deletion/service';
import { loadDeletionPolicy } from '../modules/account-deletion/config';
import { assertExtensionApprovalScope } from '../modules/account-deletion/stripeExtension';

async function main() {
  const command = process.argv[2] || 'dry-run';
  const collection = firestore.collection('account_deletion_requests');
  if (command === 'dry-run') {
    let cursor: string | undefined;
    const counts: Record<string, number> = {};
    let overdue = 0;
    do {
      const query = collection.orderBy(FieldPath.documentId()).limit(100);
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      for (const doc of page.docs) {
        const state = doc.get('state');
        counts[state] = (counts[state] || 0) + 1;
        if (
          state !== 'completed' &&
          (asDate(doc.get('eraseTargetAt'))?.getTime() ?? Infinity) < Date.now()
        )
          overdue++;
      }
      cursor = page.size === 100 ? page.docs[99].id : undefined;
    } while (cursor);
    console.log(JSON.stringify({ mode: 'read_only', counts, overdue }));
    return;
  }
  const policy = loadDeletionPolicy();
  if (!process.argv.includes('--apply'))
    throw new Error('Explicit --apply required');
  if (command === 'review-order') {
    const input = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const completedAt = asDate(input.completedAt);
    if (
      !completedAt ||
      completedAt.getTime() > Date.now() ||
      typeof input.reviewer !== 'string' ||
      input.reviewer.length < 3 ||
      typeof input.evidenceReference !== 'string' ||
      input.evidenceReference.length < 8 ||
      typeof input.orderId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.orderId)
    )
      throw new Error('Verified date and evidence required');
    const ref = firestore.collection('orders').doc(input.orderId);
    await firestore.runTransaction(async (tx) => {
      const order = await tx.get(ref);
      if (
        !order.exists ||
        order.get('deletionMinimised') ||
        !['delivered', 'cancelled'].includes(order.get('status')) ||
        order.get('deletionHold') ||
        order.get('disputeOpen') ||
        order.get('buyerDisputeStatus') === 'under_review' ||
        order.get('shipmentCreationPending') ||
        order.get('refundPending') ||
        order.get('payoutPending')
      )
        throw new Error('Operational case remains open');
      const existingCreatedAt = asDate(order.get('createdAt'));
      const createdAt = existingCreatedAt || asDate(input.createdAt);
      if (
        !createdAt ||
        completedAt < createdAt ||
        (input.createdAt !== undefined &&
          existingCreatedAt &&
          asDate(input.createdAt)?.getTime() !== existingCreatedAt.getTime())
      )
        throw new Error('Verified creation and completion dates required');
      if (
        order.get('status') === 'cancelled' &&
        input.financialSettlementConfirmed !== true
      )
        throw new Error(
          'Cancelled payments require independently verified financial settlement',
        );
      tx.update(ref, {
        ...(!existingCreatedAt ? { createdAt } : {}),
        completedAt,
        retentionReviewedAt: new Date(),
        retentionReviewer: input.reviewer,
        retentionReviewEvidence: input.evidenceReference,
        ...(order.get('status') === 'cancelled'
          ? {
              financialReconciliation: {
                status: 'settled',
                reviewedAt: new Date(),
                reviewer: input.reviewer,
                evidenceReference: input.evidenceReference,
              },
            }
          : {}),
      });
    });
    console.log(
      'Verified terminal order date recorded; deletion worker will reconsider the hold.',
    );
    return;
  }
  if (command === 'resolve-task') {
    const path = process.argv[3];
    const input = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !/^[a-f0-9-]{36}$/.test(input.requestId) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(input.taskId)
    )
      throw new Error('Invalid identifiers');
    const request = collection.doc(input.requestId);
    const ref = request.collection('tasks').doc(input.taskId);
    await firestore.runTransaction(async (tx) => {
      const [job, task] = await Promise.all([tx.get(request), tx.get(ref)]);
      if (
        !job.exists ||
        !task.exists ||
        (asDate(job.get('leaseUntil'))?.getTime() || 0) > Date.now()
      )
        throw new Error('Not found or worker active');
      if (task.get('kind') === 'stripe_extension_review')
        assertExtensionApprovalScope(task.data(), input);
      const resolution = {
        ...task.data(),
        status: 'resolved',
        resolvedAt: new Date(),
        resolutionCode: input.resolutionCode,
        evidenceReference: input.evidenceReference,
        reviewer: input.reviewer,
        ...(task.get('kind') === 'stripe_extension_review'
          ? {
              customerOwnershipVerified: input.customerOwnershipVerified,
              financialEvidencePreserved: input.financialEvidencePreserved,
              supportContinuityVerified: input.supportContinuityVerified,
              writersStoppedAndDrained: input.writersStoppedAndDrained,
              writerEvidenceReference: input.writerEvidenceReference,
              approvedReviewGeneration: input.expectedReviewGeneration,
              approvedMappingHash: input.expectedMappingHash,
              approvedConfigurationEvidence:
                input.expectedConfigurationEvidence,
            }
          : {}),
      };
      if (!validResolution(resolution))
        throw new Error(
          'Documented evidence, reviewer and valid resolution are required',
        );
      tx.update(ref, {
        status: 'resolved',
        resolvedAt: resolution.resolvedAt,
        resolutionCode: resolution.resolutionCode,
        evidenceReference: resolution.evidenceReference,
        reviewer: resolution.reviewer,
        ...(task.get('kind') === 'stripe_extension_review'
          ? {
              customerOwnershipVerified: resolution.customerOwnershipVerified,
              financialEvidencePreserved: resolution.financialEvidencePreserved,
              supportContinuityVerified: resolution.supportContinuityVerified,
              writersStoppedAndDrained: resolution.writersStoppedAndDrained,
              writerEvidenceReference: resolution.writerEvidenceReference,
              approvedReviewGeneration: resolution.approvedReviewGeneration,
              approvedMappingHash: resolution.approvedMappingHash,
              approvedConfigurationEvidence:
                resolution.approvedConfigurationEvidence,
            }
          : {}),
        contactEmail: FieldValue.delete(),
        target: createHash('sha256')
          .update(String(task.get('target') || ''))
          .digest('hex'),
      });
      tx.update(request, { nextAttemptAt: new Date() });
    });
    console.log(
      JSON.stringify({
        event: 'deletion_review_resolved',
        requestId: input.requestId,
      }),
    );
    return;
  }
  if (command !== 'run') throw new Error('Use dry-run, run or resolve-task');
  if (process.env.ACCOUNT_DELETION_WORKER_ENABLED !== 'true')
    throw new Error('Worker disabled');
  const service = new DeletionService(firestore, admin.auth());
  await service.expireReceipts();
  const state = firestore
    .collection('account_deletion_worker_state')
    .doc('scan');
  const cursor = (await state.get()).get('cursor');
  const query = collection.orderBy(FieldPath.documentId()).limit(25);
  const jobs = await (cursor ? query.startAfter(cursor) : query).get();
  const start = Date.now();
  let last: string | null = null;
  let alerted = false;
  for (const job of jobs.docs) {
    last = job.id;
    const data = job.data();
    if (data.state === 'completed') {
      // Keep sweeping during audit retention: pre-closure resumable sessions can finish late.
      if (!(await sweepOwnedMedia(admin.storage(), data.uid)))
        await service.expireCompletedAudit(job.id);
    } else {
      const overdue =
        (asDate(data.eraseTargetAt)?.getTime() ?? Infinity) < Date.now() ||
        (asDate(data.responseDueAt)?.getTime() ?? Infinity) < Date.now();
      if (
        overdue ||
        data.state === 'requires_review' ||
        data.state === 'retrying'
      ) {
        console.error(
          JSON.stringify({
            event: 'account_deletion_attention',
            requestId: job.id,
            overdue,
          }),
        );
        alerted = true;
      }
      for (let pass = 0; pass < 10 && Date.now() - start < 50000; pass++) {
        try {
          const changed = await service.process(
            job.id,
            new AccountCleanup(firestore, admin.storage(), policy),
          );
          if (!changed) break;
        } catch {
          console.error(
            JSON.stringify({
              event: 'account_deletion_attention',
              requestId: job.id,
              reason: 'configuration_review',
            }),
          );
          alerted = true;
          break;
        }
      }
    }
    if (Date.now() - start >= 50000) break;
  }
  await state.set({
    cursor:
      jobs.empty || (last === jobs.docs[jobs.size - 1]?.id && jobs.size < 25)
        ? null
        : last,
  });
  console.log(
    JSON.stringify({
      event: 'account_deletion_worker_finished',
      inspected: jobs.size,
      attentionRequired: alerted,
    }),
  );
  // Monitoring must alert on structured attention events; do not fail/replay a successful batch.
}
main().catch(() => {
  console.error(
    'Account deletion command failed; check configuration and restricted operational records.',
  );
  process.exitCode = 1;
});
