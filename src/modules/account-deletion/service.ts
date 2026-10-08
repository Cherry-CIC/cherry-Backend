import { randomUUID } from 'crypto';
import { Auth } from 'firebase-admin/auth';
import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  DeletionError,
  loadDeletionPolicy,
  ordinaryResponseDeadline,
  RetentionPolicy,
  extensionConfigurationEvidence,
} from './config';
import { sameHash, statusTokenValid, tokenHash } from './crypto';
import { prepareAppleRevocation, revokeApple } from './apple';
import {
  captureExtensionCustomer,
  reopenForExtensionData,
} from './stripeExtension';

export interface CleanupResult {
  holds: string[];
  nextReviewAt?: Date;
  liveErased: boolean;
  contextCaptured?: boolean;
}
export interface CleanupAdapter {
  run(
    uid: string,
    requestId: string,
    now: Date,
    assertLease?: () => Promise<void>,
  ): Promise<CleanupResult>;
}
const dateOf = (value: any): Date | undefined =>
  value instanceof Timestamp
    ? value.toDate()
    : value instanceof Date
      ? value
      : undefined;
const iso = (value: any) => dateOf(value)?.toISOString() || null;
const requestCollection = 'account_deletion_requests';
const guardCollection = 'account_deletion_guards';

export class DeletionService {
  constructor(
    private db: Firestore,
    private auth: Auth,
    private policyLoader: () => RetentionPolicy = loadDeletionPolicy,
  ) {}

  async request(uid: string, receipt: string, appleCode?: string) {
    const policy = this.policyLoader();
    if (!statusTokenValid(receipt))
      throw new DeletionError('STATUS_TOKEN_REQUIRED', 400);
    const guardRef = this.db.collection(guardCollection).doc(uid);
    const existing = await guardRef.get();
    if (existing.exists) {
      const request = await this.db
        .collection(requestCollection)
        .doc(existing.get('requestId'))
        .get();
      if (!request.exists) throw new DeletionError('DELETION_REVIEW_REQUIRED');
      // The originally chosen capability remains stable across retries.
      if (!sameHash(request.get('statusTokenHash'), tokenHash(receipt))) {
        throw new DeletionError('USE_EXISTING_STATUS_TOKEN', 409);
      }
      return this.publicStatus(request.id, request.data()!);
    }
    const user = await this.auth.getUser(uid);
    const appleProvider = user.providerData.find(
      (provider) => provider.providerId === 'apple.com',
    );
    const appleRequired = !!appleProvider;
    const appleToken = appleProvider
      ? await prepareAppleRevocation(appleCode || '', appleProvider.uid)
      : undefined;
    const requestId = randomUUID();
    const ref = this.db.collection(requestCollection).doc(requestId);
    const now = new Date();
    const data = {
      uid,
      state: 'accepted',
      requestedAt: now,
      updatedAt: now,
      eraseTargetAt: new Date(now.getTime() + 28 * 86400000),
      responseDueAt: ordinaryResponseDeadline(now),
      nextAttemptAt: now,
      statusTokenHash: tokenHash(receipt),
      statusTokenExpiresAt: new Date(now.getTime() + 90 * 86400000),
      policyVersion: policy.policyVersion,
      policy,
      extensionConfigurationEvidence: extensionConfigurationEvidence(),
      attempts: 0,
      holds: [],
      appleRequired,
      ...(appleToken ? { appleToken } : {}),
    };
    return this.db.runTransaction(async (transaction) => {
      const guard = await transaction.get(guardRef);
      if (guard.exists)
        throw new DeletionError('REQUEST_ALREADY_ACCEPTED', 409);
      transaction.create(ref, data);
      transaction.create(guardRef, {
        requestId,
        blocked: true,
        requestedAt: now,
      });
      // Auth can contain an email even when the application's profile is missing.
      // Capture only the discovery contact needed by the recipient review, privately.
      if (user.email)
        transaction.set(
          ref.collection('tasks').doc('legacy-stripe-discovery'),
          {
            kind: 'provider',
            provider: 'stripe',
            status: 'pending',
            contactEmail: user.email,
            target: uid,
            reason: 'legacy_customer_discovery',
            createdAt: now,
            reviewAt: now,
          },
        );
      transaction.set(ref.collection('tasks').doc('resend-account-review'), {
        kind: 'provider',
        provider: 'resend',
        status: 'pending',
        target: uid,
        ...(user.email ? { contactEmail: user.email } : {}),
        reason: 'transactional_email_and_label_attachment_review',
        createdAt: now,
        reviewAt: now,
      });
      if (user.email)
        transaction.set(ref.collection('operational').doc('contact'), {
          email: user.email,
          purpose: 'existing_transaction_support',
          reviewAt: now,
        });
      return this.publicStatus(requestId, data);
    });
  }

  async statusForUser(uid: string) {
    const guard = await this.db.collection(guardCollection).doc(uid).get();
    if (!guard.exists) throw new DeletionError('REQUEST_NOT_FOUND', 404);
    const request = await this.db
      .collection(requestCollection)
      .doc(guard.get('requestId'))
      .get();
    if (!request.exists) throw new DeletionError('REQUEST_NOT_FOUND', 404);
    return this.publicStatus(request.id, request.data()!);
  }

  async statusWithReceipt(requestId: string | undefined, receipt: string) {
    if (
      (requestId !== undefined && !/^[a-f0-9-]{36}$/.test(requestId)) ||
      !statusTokenValid(receipt)
    ) {
      throw new DeletionError('REQUEST_NOT_FOUND', 404);
    }
    const hash = tokenHash(receipt);
    // A lost acceptance response must be recoverable using the secret saved
    // before submission, even after Authentication has already been removed.
    const matches = [];
    for (const collection of [requestCollection, 'account_deletion_receipts']) {
      if (requestId) {
        const snapshot = await this.db
          .collection(collection)
          .doc(requestId)
          .get();
        if (snapshot.exists) matches.push(snapshot);
      } else {
        const snapshots = await this.db
          .collection(collection)
          .where('statusTokenHash', '==', hash)
          .limit(2)
          .get();
        matches.push(...snapshots.docs);
      }
    }
    const ids = new Set(matches.map((snapshot) => snapshot.id));
    if (ids.size !== 1) throw new DeletionError('REQUEST_NOT_FOUND', 404);
    const request = matches[0];
    const data = request.data();
    if (
      !data ||
      !sameHash(data.statusTokenHash, hash) ||
      (dateOf(data.statusTokenExpiresAt)?.getTime() || 0) <= Date.now()
    ) {
      throw new DeletionError('REQUEST_NOT_FOUND', 404);
    }
    return this.publicStatus(request.id, data);
  }

  /** Preserve only the advertised receipt, without UID, after private audit expiry. */
  async expireCompletedAudit(
    requestId: string,
    now = new Date(),
  ): Promise<boolean> {
    const ref = this.db.collection(requestCollection).doc(requestId);
    const snapshot = await ref.get();
    const data = snapshot.data();
    if (!data || data.state !== 'completed') return false;
    if (
      data.extensionConfigurationEvidence !== extensionConfigurationEvidence()
    ) {
      await ref.update({
        state: 'requires_review',
        holds: ['extension_configuration_review'],
        nextAttemptAt: now,
        updatedAt: now,
        completedAt: FieldValue.delete(),
        auditExpiresAt: FieldValue.delete(),
      });
      return false;
    }
    if (await reopenForExtensionData(this.db, ref, data.uid, now)) return false;
    if ((dateOf(data.auditExpiresAt)?.getTime() ?? Infinity) > now.getTime())
      return false;
    try {
      await this.auth.getUser(data.uid);
      throw new DeletionError('AUTHENTICATION_STILL_EXISTS');
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.get('state') !== 'completed')
        throw new DeletionError('DELETION_REVIEW_REQUIRED');
      const guardRef = this.db.collection(guardCollection).doc(data.uid);
      const guard = await transaction.get(guardRef);
      if ((dateOf(data.statusTokenExpiresAt)?.getTime() || 0) > now.getTime()) {
        const receipt: Record<string, any> = {};
        for (const key of [
          'state',
          'requestedAt',
          'updatedAt',
          'eraseTargetAt',
          'responseDueAt',
          'authenticationDeletedAt',
          'liveDataErasedAt',
          'completedAt',
          'statusTokenHash',
          'statusTokenExpiresAt',
        ]) {
          if (data[key] !== undefined) receipt[key] = data[key];
        }
        transaction.set(
          this.db.collection('account_deletion_receipts').doc(requestId),
          receipt,
        );
      }
      // Delete the guard before the audit tree. A crash cannot strand a guard
      // whose request is gone; Authentication has been absent for the audit period.
      if (guard.get('requestId') === requestId) transaction.delete(guardRef);
    });
    await this.db.recursiveDelete(ref);
    return true;
  }

  async expireReceipts(now = new Date()): Promise<number> {
    const expired = await this.db
      .collection('account_deletion_receipts')
      .where('statusTokenExpiresAt', '<=', now)
      .limit(100)
      .get();
    if (expired.empty) return 0;
    const batch = this.db.batch();
    for (const receipt of expired.docs) batch.delete(receipt.ref);
    await batch.commit();
    return expired.size;
  }

  publicStatus(requestId: string, data: Record<string, any>) {
    return {
      requestId,
      state: data.state,
      accountRestricted: true,
      requestedAt: iso(data.requestedAt),
      updatedAt: iso(data.updatedAt),
      eraseTargetAt: iso(data.eraseTargetAt),
      responseDueAt: iso(data.responseDueAt),
      authenticationDeletedAt: iso(data.authenticationDeletedAt),
      liveDataErasedAt: iso(data.liveDataErasedAt),
      completedAt: iso(data.completedAt),
      statusTokenExpiresAt: iso(data.statusTokenExpiresAt),
      nextReviewAt: iso(data.nextAttemptAt),
      reason:
        data.state === 'retrying'
          ? 'TEMPORARY_PROCESSING_FAILURE'
          : data.holds?.length
            ? 'RETENTION_OR_REVIEW_PENDING'
            : null,
    };
  }

  async process(requestId: string, cleanup: CleanupAdapter): Promise<boolean> {
    const policy = this.policyLoader();
    if (process.env.ACCOUNT_DELETION_WORKER_ENABLED !== 'true') {
      throw new DeletionError('WORKER_DISABLED');
    }
    const ref = this.db.collection(requestCollection).doc(requestId);
    const owner = randomUUID();
    const leaseMillis = 15 * 60 * 1000;
    const acquired = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const job = snapshot.data();
      if (
        !job ||
        job.state === 'completed' ||
        (dateOf(job.leaseUntil)?.getTime() || 0) > Date.now() ||
        (dateOf(job.nextAttemptAt)?.getTime() || 0) > Date.now()
      )
        return false;
      if (
        job.policyVersion !== policy.policyVersion ||
        Object.entries(policy).some(
          ([key, value]) => job.policy?.[key] !== value,
        )
      )
        throw new DeletionError('POLICY_VERSION_REVIEW_REQUIRED');
      if (
        job.extensionConfigurationEvidence !== extensionConfigurationEvidence()
      )
        throw new DeletionError('EXTENSION_CONFIGURATION_REVIEW_REQUIRED');
      transaction.update(ref, {
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + leaseMillis),
        state: 'processing',
        attempts: FieldValue.increment(1),
        updatedAt: new Date(),
      });
      return true;
    });
    if (!acquired) return false;
    let leaseLost = false;
    const assertLease = async () => {
      this.policyLoader();
      if (process.env.ACCOUNT_DELETION_WORKER_ENABLED !== 'true' || leaseLost)
        throw new DeletionError('LEASE_LOST');
      const snapshot = await ref.get();
      if (
        snapshot.get('leaseOwner') !== owner ||
        (dateOf(snapshot.get('leaseUntil'))?.getTime() || 0) <= Date.now()
      )
        throw new DeletionError('LEASE_LOST');
    };
    const write = async (data: Record<string, any>) =>
      this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (
          snapshot.get('leaseOwner') !== owner ||
          (dateOf(snapshot.get('leaseUntil'))?.getTime() || 0) <= Date.now()
        )
          throw new DeletionError('LEASE_LOST');
        transaction.update(ref, { ...data, updatedAt: new Date() });
      });
    // Heartbeat is drained before returning; no detached cleanup in a Cloud Run request.
    let heartbeat: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat
        .then(() => write({ leaseUntil: new Date(Date.now() + leaseMillis) }))
        .catch(() => {
          leaseLost = true;
        });
    }, 60000);
    try {
      const job = (await ref.get()).data()!;
      await assertLease();
      await captureExtensionCustomer(
        this.db,
        job.uid,
        requestId,
        new Date(),
        assertLease,
      );
      try {
        await this.auth.revokeRefreshTokens(job.uid);
        await this.auth.updateUser(job.uid, { disabled: true });
      } catch (error: any) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
      if (job.appleRequired && !job.appleRevokedAt) {
        if (!job.appleToken)
          throw new DeletionError('APPLE_REVOCATION_REVIEW_REQUIRED');
        await assertLease();
        await revokeApple(job.appleToken);
        await write({
          appleRevokedAt: new Date(),
          appleToken: FieldValue.delete(),
        });
      }
      // Durable UID, policy and recipient context now survive Authentication removal.
      if (!job.authenticationDeletedAt) {
        await assertLease();
        try {
          await this.auth.deleteUser(job.uid);
        } catch (error: any) {
          if (error?.code !== 'auth/user-not-found') throw error;
        }
        await write({ authenticationDeletedAt: new Date() });
      }
      const result = await cleanup.run(
        job.uid,
        requestId,
        new Date(),
        assertLease,
      );
      await this.db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (
          current.get('leaseOwner') !== owner ||
          (dateOf(current.get('leaseUntil'))?.getTime() || 0) <= Date.now()
        ) {
          throw new DeletionError('LEASE_LOST');
        }
        const pendingTasks = await transaction.get(
          ref.collection('tasks').where('status', '==', 'pending').limit(1),
        );
        const holds = [
          ...new Set([
            ...result.holds,
            ...(pendingTasks.empty ? [] : ['recipient_review']),
          ]),
        ];
        const liveErased = result.liveErased && pendingTasks.empty;
        const completed = liveErased && holds.length === 0;
        const inProgress = holds.includes('cleanup_in_progress');
        const now = new Date();
        transaction.update(ref, {
          updatedAt: now,
          state: completed
            ? 'completed'
            : liveErased
              ? 'retained'
              : inProgress
                ? 'accepted'
                : 'requires_review',
          holds,
          ...(liveErased
            ? { liveDataErasedAt: job.liveDataErasedAt || now }
            : {}),
          ...(completed
            ? {
                completedAt: now,
                auditExpiresAt: new Date(
                  now.getTime() + policy.auditDays * 86400000,
                ),
              }
            : {}),
          nextAttemptAt: completed
            ? null
            : inProgress
              ? now
              : result.nextReviewAt ||
                new Date(now.getTime() + policy.reviewDays * 86400000),
          lastErrorCode: FieldValue.delete(),
          leaseOwner: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        });
      });
      return true;
    } catch (error) {
      if (!leaseLost) {
        await write({
          state: 'retrying',
          lastErrorCode:
            error instanceof DeletionError ? error.code : 'PROCESSING_FAILED',
          nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
          leaseOwner: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        }).catch(() => undefined);
      }
      // Never print SDK/provider exceptions: they may contain personal data or secrets.
      console.error(
        JSON.stringify({ event: 'account_deletion_retry', requestId }),
      );
      return false;
    } finally {
      clearInterval(timer);
      await heartbeat;
    }
  }
}
