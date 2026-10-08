import { createHash } from 'crypto';
import {
  DocumentReference,
  CollectionReference,
  FieldPath,
  FieldValue,
  Firestore,
  Query,
  Timestamp,
} from 'firebase-admin/firestore';
import { Storage } from 'firebase-admin/storage';
import { RetentionPolicy } from './config';
import { CleanupResult } from './service';
import {
  eraseReviewedExtensionCustomer,
  extensionReviewApproved,
} from './stripeExtension';

export const asDate = (value: any): Date | undefined => {
  const date =
    value instanceof Timestamp
      ? value.toDate()
      : value instanceof Date
        ? value
        : typeof value === 'string'
          ? new Date(value)
          : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
};
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return result;
}
export function financialExpiry(date: Date, policy: RetentionPolicy): Date {
  let end = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      policy.financialYearEndMonth - 1,
      policy.financialYearEndDay,
      23,
      59,
      59,
      999,
    ),
  );
  if (date > end)
    end = new Date(
      Date.UTC(
        date.getUTCFullYear() + 1,
        policy.financialYearEndMonth - 1,
        policy.financialYearEndDay,
        23,
        59,
        59,
        999,
      ),
    );
  return addMonths(end, policy.financialYears * 12);
}
export function ownedMediaPath(
  url: string,
  uid: string,
  bucket: string,
): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'firebasestorage.googleapis.com'
    )
      return null;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || decodeURIComponent(match[1]) !== bucket) return null;
    const path = decodeURIComponent(match[2]);
    return [`products/${uid}/`, `user_images/${uid}/`].some((prefix) =>
      path.startsWith(prefix),
    )
      ? path
      : null;
  } catch {
    return null;
  }
}
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const mediaReference = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return `unparsed:${digest(url)}`;
  }
};
const choose = (data: Record<string, any>, keys: string[]) =>
  Object.fromEntries(
    keys
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
export async function sweepOwnedMedia(
  storage: Storage,
  uid: string,
  assertLease: () => Promise<void> = async () => undefined,
): Promise<boolean> {
  let found = false;
  for (const prefix of [`products/${uid}/`, `user_images/${uid}/`]) {
    const [files] = await storage
      .bucket()
      .getFiles({ prefix, maxResults: 100, autoPaginate: false });
    for (const file of files) {
      await assertLease();
      await file.delete({ ignoreNotFound: true });
      found = true;
    }
  }
  return found;
}
const resolutions: Record<string, string[]> = {
  provider: [
    'recipient_erasure_confirmed',
    'independent_controller_retention_confirmed',
  ],
  ambiguous_media: ['asset_not_owned_confirmed', 'asset_erasure_confirmed'],
  ownership_review: ['asset_not_owned_confirmed', 'asset_erasure_confirmed'],
  exports_lifecycle_review: [
    'recipient_erasure_confirmed',
    'inventory_verified',
  ],
  financial_date_review: ['terminal_date_confirmed'],
};
export const validResolution = (task: any): boolean =>
  task?.kind === 'stripe_extension_review'
    ? extensionReviewApproved(task)
    : task?.status === 'resolved' &&
      !!asDate(task.resolvedAt) &&
      typeof task.evidenceReference === 'string' &&
      task.evidenceReference.length >= 8 &&
      typeof task.reviewer === 'string' &&
      task.reviewer.length >= 3 &&
      (resolutions[task.kind] || []).includes(task.resolutionCode);

const hasOperationalHold = (data: Record<string, any>): boolean =>
  data.deletionHold === true ||
  data.shipmentCreationPending === true ||
  data.disputeOpen === true ||
  data.buyerDisputeStatus === 'under_review' ||
  data.refundPending === true ||
  data.payoutPending === true;

export const financialSettlementVerified = (
  data: Record<string, any>,
): boolean => {
  const review = data.financialReconciliation;
  return (
    review?.status === 'settled' &&
    !!asDate(review.reviewedAt) &&
    typeof review.reviewer === 'string' &&
    review.reviewer.length >= 3 &&
    typeof review.evidenceReference === 'string' &&
    review.evidenceReference.length >= 8
  );
};

/** Every pass is checkpointed. A failed pass can be repeated without trusting counts. */
export class AccountCleanup {
  private job!: DocumentReference;
  private uid = '';
  private now = new Date();
  private assertLease: () => Promise<void> = async () => undefined;
  constructor(
    private db: Firestore,
    private storage: Storage,
    private policy: RetentionPolicy,
  ) {}

  private async task(
    kind: string,
    target: string,
    extra: Record<string, any> = {},
  ) {
    const ref = this.job.collection('tasks').doc(digest(`${kind}:${target}`));
    const current = await ref.get();
    if (!current.exists) {
      await this.assertLease();
      await ref.create({
        kind,
        target,
        status: 'pending',
        createdAt: this.now,
        reviewAt: this.now,
        ...extra,
      });
    }
    return current.exists && validResolution(current.data());
  }
  private async eraseTree(ref: DocumentReference | CollectionReference) {
    await this.assertLease();
    const writer = this.db.bulkWriter({
      throttling: { initialOpsPerSecond: 50, maxOpsPerSecond: 100 },
    });
    writer.onWriteError((error) => error.failedAttempts < 3);
    try {
      await this.db.recursiveDelete(ref, writer);
    } finally {
      await writer.close();
    }
  }
  private page(query: Query, cursor?: string) {
    const ordered = query.orderBy(FieldPath.documentId()).limit(50);
    return (cursor ? ordered.startAfter(cursor) : ordered).get();
  }
  private async collect(query: Query, target: string, cursor?: string) {
    const page = await this.page(query, cursor);
    await this.assertLease();
    const batch = this.db.batch();
    for (const doc of page.docs)
      batch.set(
        this.job.collection(target).doc(doc.id),
        { path: doc.ref.path },
        { merge: true },
      );
    await batch.commit();
    return { more: page.size === 50, cursor: page.docs[page.size - 1]?.id };
  }
  private async eraseLike(ref: DocumentReference) {
    await this.assertLease();
    const erased = await this.db.runTransaction(async (tx) => {
      const edge = await tx.get(ref);
      if (!edge.exists) return true;
      const productId = edge.get('productId');
      const product =
        typeof productId === 'string' && productId && !productId.includes('/')
          ? await tx.get(this.db.collection('products').doc(productId))
          : undefined;
      if (
        edge.get('userId') !== this.uid &&
        product?.get('userId') !== this.uid
      )
        return false;
      // Decrement and remove the edge atomically. A retry cannot subtract twice.
      if (product?.exists) {
        const count = product.get('likes');
        tx.update(product.ref, {
          likes: Math.max(
            0,
            (typeof count === 'number' && Number.isFinite(count) ? count : 0) -
              1,
          ),
        });
      }
      tx.delete(ref);
      return true;
    });
    if (erased) await this.eraseTree(ref);
    else await this.task('ownership_review', ref.path);
  }
  private async profile(ref: DocumentReference) {
    const doc = await ref.get();
    const data = doc.data() || {};
    // Do not delete a colliding legacy document owned by a different UID.
    if (
      (data.id && data.id !== this.uid) ||
      (data.firebaseUid && data.firebaseUid !== this.uid)
    ) {
      await this.task('ownership_review', ref.path);
      return;
    }
    const legacyContact = await this.job
      .collection('tasks')
      .doc('legacy-stripe-discovery')
      .get();
    if (
      typeof data.email === 'string' &&
      legacyContact.get('contactEmail') !== data.email &&
      !validResolution(legacyContact.data())
    ) {
      await this.task('provider', `stripe:${digest(data.email)}`, {
        provider: 'stripe',
        contactEmail: data.email,
        reason: 'legacy_customer_discovery',
      });
    }
    if (typeof data.email === 'string') {
      const emailReview = await this.job
        .collection('tasks')
        .doc('resend-account-review')
        .get();
      if (
        emailReview.get('contactEmail') !== data.email &&
        !validResolution(emailReview.data())
      ) {
        await this.task('provider', `resend:${digest(data.email)}`, {
          provider: 'resend',
          contactEmail: data.email,
          reason: 'legacy_transactional_email_review',
        });
      }
    }
    if (data.email || data.phone) {
      await this.job
        .collection('operational')
        .doc('contact')
        .set(
          {
            ...choose(data, ['email', 'phone', 'firstname', 'displayName']),
            purpose: 'existing_transaction_support',
            reviewAt: this.now,
          },
          { merge: true },
        );
    }
    for (const value of [
      data.profileImageUrl,
      data.photoURL,
      data.photoUrl,
      data.photo,
    ]) {
      if (
        typeof value === 'string' &&
        value &&
        !ownedMediaPath(value, this.uid, this.storage.bucket().name)
      ) {
        // A URL is not ownership proof. Keep a private reference for human verification.
        await this.task('ambiguous_media', mediaReference(value), {
          reason: 'profile_ownership_unverified',
        });
      }
    }
    await this.eraseTree(ref);
  }
  private async processOrder(orderId: string): Promise<boolean> {
    const marker = this.job.collection('cleanup_orders').doc(orderId);
    const previouslyMinimised = (await marker.get()).get('minimised') === true;
    const ref = this.db.collection('orders').doc(orderId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return true;
    const data = snapshot.data()!;
    await this.task('provider', `resend-order:${orderId}`, {
      provider: 'resend',
      reason: 'order_email_and_label_attachment_review',
    });
    const holdRef = this.job.collection('holds').doc(orderId);
    const retained = this.db.collection('account_retained_orders').doc(orderId);
    const priorRetention = await retained.get();
    // An already expired counterparty history shell has no retention purpose
    // left to restart when its remaining participant closes their account.
    if (
      data.retentionExpired === true &&
      !hasOperationalHold(data) &&
      !hasOperationalHold(priorRetention.data() || {})
    ) {
      await this.assertLease();
      await this.db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (!current.exists) return;
        if (hasOperationalHold(current.data()!))
          throw new Error('Order hold changed');
        const remaining = choose(current.data()!, [
          'userId',
          'sellerId',
          'status',
        ]);
        for (const key of ['userId', 'sellerId'])
          if (
            remaining[key] === this.uid ||
            String(remaining[key] || '').startsWith('deleted:')
          )
            delete remaining[key];
        if (remaining.userId || remaining.sellerId)
          tx.set(ref, {
            ...remaining,
            retentionExpired: true,
            deletionMinimised: true,
          });
        else tx.delete(ref);
        tx.delete(holdRef);
        tx.set(marker, { minimised: true }, { merge: true });
      });
      return true;
    }
    const terminal = ['delivered', 'cancelled'].includes(data.status);
    const completedAt =
      asDate(data.completedAt) ||
      asDate(data.deliveredAt) ||
      asDate(data.cancelledAt);
    const explicitHold = hasOperationalHold(data);
    const unsettledCancellation =
      data.status === 'cancelled' && !financialSettlementVerified(data);
    const alreadyAssessed =
      data.deletionMinimised === true && priorRetention.exists;
    if (
      explicitHold ||
      hasOperationalHold(priorRetention.data() || {}) ||
      (!previouslyMinimised &&
        (!terminal ||
          (!completedAt && !alreadyAssessed) ||
          (unsettledCancellation && !alreadyAssessed)))
    ) {
      await this.assertLease();
      await holdRef.set({
        kind: 'operational_order',
        orderId,
        reason: !terminal
          ? 'active_order'
          : !completedAt
            ? 'completion_date_unverified'
            : unsettledCancellation
              ? 'cancellation_settlement_unverified'
              : 'unresolved_financial_case',
        reviewAt: new Date(
          this.now.getTime() + this.policy.reviewDays * 86400000,
        ),
        releaseCondition:
          'verified terminal status and completion date; all financial cases resolved',
      });
      return false;
    }
    if (previouslyMinimised) {
      await this.assertLease();
      await holdRef.delete();
      return true;
    }
    const evidenceExpiresAt =
      asDate(priorRetention.get('evidenceExpiresAt')) ||
      addMonths(completedAt!, this.policy.orderEvidenceMonths);
    const createdAt = asDate(data.createdAt);
    if (!createdAt && !alreadyAssessed) {
      await this.task('financial_date_review', orderId);
      await this.assertLease();
      await holdRef.set({
        kind: 'operational_order',
        orderId,
        reason: 'financial_date_unverified',
        reviewAt: new Date(
          this.now.getTime() + this.policy.reviewDays * 86400000,
        ),
        releaseCondition:
          'verified creation date stored and retention minimisation completed',
      });
      return false;
    }
    const financialExpiresAt =
      asDate(priorRetention.get('financialExpiresAt')) ||
      financialExpiry(createdAt!, this.policy);
    // Whitelists exclude names, email, street addresses, telephone, photos and free text.
    const financial = choose(data, [
      'productAmount',
      'shippingFee',
      'securityFee',
      'totalAmount',
      'currency',
      'paymentIntentId',
      'charityId',
      'createdAt',
    ]);
    const evidence = choose(data, [
      'userId',
      'sellerId',
      'productId',
      'paymentIntentId',
      'shipmentId',
      'status',
      'shipmentStatus',
      'createdAt',
    ]);
    await this.assertLease();
    await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(retained);
      const currentOrder = await transaction.get(ref);
      if (
        !currentOrder.exists ||
        !currentOrder.updateTime?.isEqual(snapshot.updateTime!)
      )
        throw new Error('Order changed during retention assessment');
      transaction.set(
        retained,
        {
          orderId,
          policyVersion: this.policy.policyVersion,
          requestIds: FieldValue.arrayUnion(this.job.id),
          ...(data.paymentIntentId
            ? { paymentIntentId: data.paymentIntentId }
            : {}),
          ...(!current.exists
            ? { financial, evidence, evidenceExpiresAt, financialExpiresAt }
            : {}),
        },
        { merge: true },
      );
      // An existing authorised hold must be reviewed, never bypassed by deletion.
      transaction.update(ref, {
        deletionMinimised: true,
        buyerDisputeMessage: FieldValue.delete(),
        buyerDisputeReason: FieldValue.delete(),
        ...(data.userId === this.uid
          ? {
              userId: `deleted:${this.job.id}`,
              email: FieldValue.delete(),
              shipping: FieldValue.delete(),
              pickupPoint: FieldValue.delete(),
            }
          : {}),
        ...(data.sellerId === this.uid
          ? { sellerId: `deleted:${this.job.id}` }
          : {}),
        // Historical text/media can embed the departing seller's personal data.
        ...(data.sellerId === this.uid
          ? {
              productName: 'Removed listing',
              productImages: FieldValue.delete(),
              product_images: FieldValue.delete(),
            }
          : {}),
      });
      transaction.delete(holdRef);
    });
    // Sendcloud recipient data belongs to the buyer. A seller's erasure request
    // must not erase another person's parcel or request erasure of their records.
    const deletingBuyer =
      data.userId === this.uid || data.userId === `deleted:${this.job.id}`;
    const shipments = await this.db
      .collection('shipments')
      .where('orderId', '==', orderId)
      .get();
    for (const shipment of shipments.docs) {
      if (!deletingBuyer) continue;
      if (shipment.get('sendcloudId') !== undefined)
        await this.task(
          'provider',
          `sendcloud:${shipment.get('sendcloudId')}`,
          { provider: 'sendcloud' },
        );
      // Retain only delivery state for the counterparty; parcel and label contain PII.
      await this.assertLease();
      await shipment.ref.set({
        ...choose(shipment.data(), [
          'orderId',
          'status',
          'provider',
          'carrier',
          'createdAt',
          'updatedAt',
        ]),
        deletionMinimised: true,
      });
      for (const child of await shipment.ref.listCollections())
        await this.eraseTree(child);
    }
    // Remove private delivery lockers, including descendants, for this user only.
    await this.eraseTree(ref.collection('lockers').doc(this.uid));
    // Idempotency locks survive until the corresponding financial expiry.
    if (data.paymentIntentId) {
      const lock = this.db
        .collection('order_payment_intents')
        .doc(data.paymentIntentId);
      if ((await lock.get()).exists)
        await lock.update({ userId: FieldValue.delete() });
    }
    await this.assertLease();
    await marker.set({ minimised: true }, { merge: true });
    return true;
  }

  private async reconcileContext(
    target: FirebaseFirestore.QueryDocumentSnapshot,
  ) {
    const ref = this.db.doc(target.get('path'));
    await this.assertLease();
    // Both closing participants need the verified outcome. Preserve it in their
    // private job pointers before erasing the shared operational context.
    await this.db.runTransaction(async (tx) => {
      const context = await tx.get(ref);
      if (!context.exists) return;
      const data = context.data()!;
      if (
        data.state !== 'cancelled' &&
        !(data.state === 'fulfilled' && data.orderId)
      )
        return;
      const uids = [...new Set([data.buyerUid, data.sellerUid])].filter(
        Boolean,
      );
      const guards = await Promise.all(
        uids.map((uid) =>
          tx.get(this.db.collection('account_deletion_guards').doc(uid)),
        ),
      );
      for (let i = 0; i < guards.length; i++) {
        const requestId = guards[i].get('requestId');
        if (!requestId) continue;
        tx.set(
          this.db
            .collection('account_deletion_requests')
            .doc(requestId)
            .collection('cleanup_contexts')
            .doc(target.id),
          {
            path: ref.path,
            outcome: {
              state: data.state,
              ...(data.orderId ? { orderId: data.orderId } : {}),
            },
            ...(uids[i] === data.buyerUid && data.customerId
              ? { providerCustomerId: data.customerId }
              : {}),
          },
          { merge: true },
        );
      }
      tx.delete(ref);
    });
    const [pointer, context] = await Promise.all([target.ref.get(), ref.get()]);
    const data = context.data();
    const customerId =
      pointer.get('providerCustomerId') ||
      (data?.buyerUid === this.uid ? data.customerId : undefined);
    if (customerId) {
      await this.task('provider', `stripe:${customerId}`, {
        provider: 'stripe',
      });
      await pointer.ref.update({ providerCustomerId: FieldValue.delete() });
    }
    const outcome = pointer.get('outcome');
    const hold = this.job.collection('holds').doc(`checkout-${target.id}`);
    if (
      outcome?.state === 'cancelled' ||
      (outcome?.state === 'fulfilled' && outcome.orderId)
    ) {
      if (outcome.orderId) {
        await this.job
          .collection('cleanup_orders')
          .doc(outcome.orderId)
          .set({ path: `orders/${outcome.orderId}` }, { merge: true });
        await this.processOrder(outcome.orderId);
      }
      await this.assertLease();
      await hold.delete();
    } else {
      await this.assertLease();
      await hold.set({
        kind: 'operational_checkout',
        checkoutId: target.id,
        reason: context.exists
          ? 'payment_reconciliation_required'
          : 'checkout_outcome_unverified',
        reviewAt: new Date(
          this.now.getTime() + this.policy.reviewDays * 86400000,
        ),
        releaseCondition: 'verified provider cancellation or fulfilled order',
      });
    }
  }

  private async expireOrder(
    record: FirebaseFirestore.QueryDocumentSnapshot,
  ): Promise<boolean> {
    const data = record.data();
    const evidenceDue =
      (asDate(data.evidenceExpiresAt)?.getTime() ?? Infinity) <=
      this.now.getTime();
    const financialDue =
      (asDate(data.financialExpiresAt)?.getTime() ?? Infinity) <=
      this.now.getTime();
    const orderRef = this.db.collection('orders').doc(record.id);
    const order = await orderRef.get();
    if (hasOperationalHold(data) || hasOperationalHold(order.data() || {})) {
      await this.job
        .collection('holds')
        .doc(record.id)
        .set({
          kind: 'operational_order',
          orderId: record.id,
          reason: 'unresolved_financial_case',
          reviewAt: new Date(
            this.now.getTime() + this.policy.reviewDays * 86400000,
          ),
          releaseCondition: 'authorised release of evidence or financial hold',
        });
      return false;
    }
    if (!evidenceDue && !financialDue) return false;
    const shipments = evidenceDue
      ? await this.db
          .collection('shipments')
          .where('orderId', '==', record.id)
          .limit(50)
          .get()
      : undefined;
    // Descendants must go before their parent and the retained checkpoint. Repeat
    // safely after a crash; do not leave unreachable personal subcollections.
    for (const shipment of shipments?.docs || []) {
      for (const child of await shipment.ref.listCollections()) {
        await this.eraseTree(child);
      }
    }
    await this.assertLease();
    return this.db.runTransaction(async (tx) => {
      const [current, live] = await Promise.all([
        tx.get(record.ref),
        tx.get(orderRef),
      ]);
      if (!current.exists) return true;
      if (
        hasOperationalHold(current.data()!) ||
        hasOperationalHold(live.data() || {})
      )
        throw new Error('Retention hold changed');
      for (const shipment of shipments?.docs || []) tx.delete(shipment.ref);
      const finished =
        evidenceDue && financialDue && (shipments?.size || 0) < 50;
      if (live.exists) {
        const next = { ...live.data()! };
        if (evidenceDue) {
          for (const key of [
            'productId',
            'shipmentId',
            'productName',
            'productImages',
            'product_images',
            'email',
            'shipping',
            'pickupPoint',
            'deliveryType',
            'shippingOptionId',
            'shippingOptionName',
            'shippingCarrier',
            'shippingWeight',
            'completedAt',
            'deliveredAt',
            'cancelledAt',
            'financialReconciliation',
            'retentionReviewedAt',
            'retentionReviewer',
            'retentionReviewEvidence',
            'buyerDisputeMessage',
            'buyerDisputeReason',
            'buyerDisputedAt',
            'buyerDisputeStatus',
            'buyerConfirmedReceivedAt',
            'sellerSoldEmailSentAt',
            'buyerShipmentStartedEmailSentAt',
            'buyerDeliveryEmailSentAt',
          ])
            delete next[key];
          for (const key of ['userId', 'sellerId'])
            if (String(next[key] || '').startsWith('deleted:'))
              delete next[key];
        }
        if (financialDue)
          for (const key of [
            'productAmount',
            'shippingFee',
            'securityFee',
            'totalAmount',
            'currency',
            'charityId',
            'paymentStatus',
          ])
            delete next[key];
        if (finished) {
          const shell = choose(next, ['userId', 'sellerId', 'status']);
          if (shell.userId || shell.sellerId)
            tx.set(orderRef, {
              ...shell,
              deletionMinimised: true,
              retentionExpired: true,
            });
          else tx.delete(orderRef);
        } else tx.set(orderRef, next);
      }
      if (finished) {
        const paymentIntentId =
          data.paymentIntentId ||
          data.financial?.paymentIntentId ||
          data.evidence?.paymentIntentId;
        if (paymentIntentId)
          tx.delete(
            this.db.collection('order_payment_intents').doc(paymentIntentId),
          );
        tx.delete(record.ref);
      } else {
        tx.update(record.ref, {
          ...(evidenceDue ? { evidence: FieldValue.delete() } : {}),
          ...(financialDue ? { financial: FieldValue.delete() } : {}),
        });
      }
      return finished;
    });
  }

  async run(
    uid: string,
    requestId: string,
    now: Date,
    assertLease: () => Promise<void> = async () => undefined,
  ): Promise<CleanupResult> {
    this.uid = uid;
    this.now = now;
    this.assertLease = assertLease;
    this.job = this.db.collection('account_deletion_requests').doc(requestId);
    const progressRef = this.job.collection('cleanup').doc('state');
    const progress = (await progressRef.get()).data() || { phase: 'products' };
    const pending = (): CleanupResult => ({
      holds: ['cleanup_in_progress'],
      liveErased: false,
      contextCaptured: true,
    });
    const advance = async (phase: string, extras = {}) => {
      await assertLease();
      await progressRef.set({ phase, ...extras });
    };
    const next = async (query: Query, target: string, after: string) => {
      const page = await this.collect(query, target, progress.cursor);
      await advance(
        page.more ? progress.phase : after,
        page.more ? { cursor: page.cursor } : {},
      );
      return pending();
    };
    if (progress.phase === 'products')
      return next(
        this.db.collection('products').where('userId', '==', uid),
        'cleanup_products',
        'buyer_orders',
      );
    if (progress.phase === 'buyer_orders')
      return next(
        this.db.collection('orders').where('userId', '==', uid),
        'cleanup_orders',
        'seller_orders',
      );
    if (progress.phase === 'seller_orders')
      return next(
        this.db.collection('orders').where('sellerId', '==', uid),
        'cleanup_orders',
        'product_orders',
      );
    if (progress.phase === 'product_orders') {
      const products = await this.page(
        this.job.collection('cleanup_products'),
        progress.cursor,
      );
      // A bounded page for ONE product; never lose the seller relationship before discovery.
      const product = products.docs[0];
      if (!product) {
        await advance('buyer_contexts');
        return pending();
      }
      const page = await this.collect(
        this.db.collection('orders').where('productId', '==', product.id),
        'cleanup_orders',
        progress.orderCursor,
      );
      // Backfill only this bounded page, never reload the entire order history.
      const orders = await this.page(
        this.db.collection('orders').where('productId', '==', product.id),
        progress.orderCursor,
      );
      for (const order of orders.docs)
        if (!order.get('sellerId')) {
          await assertLease();
          await order.ref.update({ sellerId: uid });
        }
      await advance(
        'product_orders',
        page.more
          ? { cursor: progress.cursor || null, orderCursor: page.cursor }
          : { cursor: product.id },
      );
      return pending();
    }
    if (progress.phase === 'buyer_contexts')
      return next(
        this.db
          .collection('account_checkout_contexts')
          .where('buyerUid', '==', uid),
        'cleanup_contexts',
        'seller_contexts',
      );
    if (progress.phase === 'seller_contexts')
      return next(
        this.db
          .collection('account_checkout_contexts')
          .where('sellerUid', '==', uid),
        'cleanup_contexts',
        'user_likes',
      );
    if (progress.phase === 'user_likes')
      return next(
        this.db.collection('user_likes').where('userId', '==', uid),
        'cleanup_likes',
        'product_likes',
      );
    if (progress.phase === 'product_likes') {
      const products = await this.page(
        this.job.collection('cleanup_products'),
        progress.cursor,
      );
      const product = products.docs[0];
      if (!product) {
        await advance('erase_likes');
        return pending();
      }
      const page = await this.collect(
        this.db.collection('user_likes').where('productId', '==', product.id),
        'cleanup_likes',
        progress.likeCursor,
      );
      await advance(
        'product_likes',
        page.more
          ? { cursor: progress.cursor || null, likeCursor: page.cursor }
          : { cursor: product.id },
      );
      return pending();
    }
    if (progress.phase === 'erase_likes') {
      const targets = await this.page(
        this.job.collection('cleanup_likes'),
        progress.cursor,
      );
      for (const target of targets.docs)
        await this.eraseLike(this.db.doc(target.get('path')));
      await advance(
        targets.size === 50 ? 'erase_likes' : 'profiles',
        targets.size === 50 ? { cursor: targets.docs[49].id } : {},
      );
      return pending();
    }
    if (
      progress.phase === 'profiles' ||
      progress.phase === 'profiles_firebase_uid'
    ) {
      const profiles = await this.page(
        this.db
          .collection('users')
          .where(
            progress.phase === 'profiles' ? 'id' : 'firebaseUid',
            '==',
            uid,
          ),
        progress.cursor,
      );
      for (const profile of profiles.docs) await this.profile(profile.ref);
      if (profiles.size === 50) {
        await advance(progress.phase, { cursor: profiles.docs[49].id });
      } else if (progress.phase === 'profiles') {
        await advance('profiles_firebase_uid');
      } else {
        await this.profile(this.db.collection('users').doc(uid));
        await this.task('exports_lifecycle_review', uid);
        await advance('orders');
      }
      return pending();
    }
    if (progress.phase === 'orders') {
      const targets = await this.page(
        this.job.collection('cleanup_orders'),
        progress.cursor,
      );
      for (const target of targets.docs) await this.processOrder(target.id);
      await advance(
        targets.size === 50 ? 'orders' : 'contexts',
        targets.size === 50
          ? { cursor: targets.docs[targets.size - 1].id }
          : {},
      );
      return pending();
    }
    if (progress.phase === 'contexts') {
      const targets = await this.page(
        this.job.collection('cleanup_contexts'),
        progress.cursor,
      );
      for (const target of targets.docs) await this.reconcileContext(target);
      await advance(
        targets.size === 50 ? 'contexts' : 'erase_products',
        targets.size === 50
          ? { cursor: targets.docs[targets.size - 1].id }
          : {},
      );
      return pending();
    }
    if (progress.phase === 'erase_products') {
      const targets = await this.page(
        this.job.collection('cleanup_products'),
        progress.cursor,
      );
      for (const target of targets.docs) {
        const ref = this.db.doc(target.get('path'));
        const product = await ref.get();
        const urls = product.get('product_images');
        for (const url of Array.isArray(urls) ? urls : []) {
          if (
            typeof url === 'string' &&
            !ownedMediaPath(url, uid, this.storage.bucket().name)
          )
            await this.task('ambiguous_media', mediaReference(url));
        }
        await assertLease();
        const kept = await this.db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          const contexts = await tx.get(
            this.db
              .collection('account_checkout_contexts')
              .where('productId', '==', target.id)
              .limit(1),
          );
          if (contexts.empty || !current.exists) return false;
          // Inventory updates from paid fulfilment participate in this transaction.
          tx.set(ref, {
            ...choose(current.data()!, [
              'userId',
              'number',
              'status',
              'price',
              'postageSize',
              'charityId',
            ]),
            name: 'Removed listing',
            deletionMinimised: true,
          });
          return true;
        });
        if (kept) {
          for (const child of await ref.listCollections())
            await this.eraseTree(child);
        } else await this.eraseTree(ref);
      }
      await advance(
        targets.size === 50 ? 'erase_products' : 'media',
        targets.size === 50
          ? { cursor: targets.docs[targets.size - 1].id }
          : {},
      );
      return pending();
    }
    if (progress.phase === 'media') {
      // Prefix ownership was verified in the frontend. Includes unused uploads and variants.
      if (await sweepOwnedMedia(this.storage, uid, assertLease))
        return pending();
      await advance('expiry', { retainedCount: 0 });
      return pending();
    }
    // Catch uploads initiated before closure that completed after the first sweep.
    if (await sweepOwnedMedia(this.storage, uid, assertLease)) return pending();
    // Expire private evidence and financial records independently; no whole-profile retention.
    const retained = await this.page(
      this.db
        .collection('account_retained_orders')
        .where('requestIds', 'array-contains', requestId),
      progress.cursor,
    );
    let retainedCount = progress.retainedCount || 0;
    for (const record of retained.docs) {
      if (!(await this.expireOrder(record))) retainedCount++;
    }
    if (retained.size === 50) {
      await advance('expiry', { cursor: retained.docs[49].id, retainedCount });
      return pending();
    }
    const extensionErased = await eraseReviewedExtensionCustomer(
      this.db,
      uid,
      requestId,
      now,
      assertLease,
    );
    const tasks = await this.job.collection('tasks').get();
    const holds = await this.job.collection('holds').limit(1).get();
    const unresolved = tasks.docs.some((task) => !validResolution(task.data()));
    if (!holds.empty)
      await advance('orders'); // Reconsider operational records on the next scheduled review.
    else {
      await assertLease();
      await this.job.collection('operational').doc('contact').delete();
      await advance('expiry', { retainedCount: 0 });
    }
    const resultHolds = [
      ...(!holds.empty ? ['operational_records'] : []),
      ...(unresolved ? ['recipient_or_media_review'] : []),
      ...(!extensionErased ? ['extension_financial_and_writer_review'] : []),
      ...(retainedCount ? ['justified_retention'] : []),
    ];
    return {
      holds: resultHolds,
      contextCaptured: true,
      liveErased: holds.empty && !unresolved && extensionErased,
      nextReviewAt: new Date(now.getTime() + this.policy.reviewDays * 86400000),
    };
  }
}
