import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { DAY_MS, DELETION_JOBS, RECEIPT_RETENTION_MS } from './jobs';
import {
  MEDIA_RETIREMENTS,
  MediaObject,
  mediaKey,
  referencesMedia,
} from './media';
import { CleanupStorage } from './storage';

const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const SCAN_LIMIT = 2000;
const date = (value: any): Date =>
  value?.toDate ? value.toDate() : new Date(value);
const safeErrors = new Set([
  'STORAGE_INSPECTION_FAILED',
  'STORAGE_DELETION_FAILED',
  'STORAGE_GENERATION_CHANGED',
  'STORAGE_CLEANUP_DISABLED',
  'STORAGE_BUCKET_MISMATCH',
]);

/** Bounded, restartable worker. Invoke from a scheduled process, never fire-and-forget HTTP work. */
export class ListingCleanupWorker {
  constructor(
    private readonly db: FirebaseFirestore.Firestore,
    private readonly storage: CleanupStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly env = process.env,
  ) {}

  async run(
    limit = 20,
    apply = false,
  ): Promise<{ inspected: number; processed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Use a limit between 1 and 100.');
    const due = await this.db
      .collection(DELETION_JOBS)
      .where('nextAttemptAt', '<=', this.now())
      .orderBy('nextAttemptAt')
      .limit(limit)
      .get();
    if (apply && this.env.LISTING_CLEANUP_ENABLED !== 'true')
      throw new Error('LISTING_CLEANUP_ENABLED is not true.');
    if (!apply) return { inspected: due.size, processed: 0 };
    let processed = 0;
    for (const doc of due.docs) if (await this.process(doc.id)) processed++;
    return { inspected: due.size, processed };
  }

  async process(id: string): Promise<boolean> {
    if (this.env.LISTING_CLEANUP_ENABLED !== 'true')
      throw new Error('LISTING_CLEANUP_ENABLED is not true.');
    const ref = this.db.collection(DELETION_JOBS).doc(id);
    const token = randomUUID();
    const job = await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const data = doc.data()!;
      const now = this.now();
      if (
        !data.nextAttemptAt ||
        date(data.nextAttemptAt) > now ||
        (data.leaseUntil && date(data.leaseUntil) > now)
      )
        return null;
      if (data.status === 'completed') {
        if (
          data.completedAt &&
          date(data.completedAt).getTime() + RECEIPT_RETENTION_MS <=
            now.getTime()
        )
          tx.delete(ref);
        return null;
      }
      if (data.status === 'review') return null;
      const leaseUntil = new Date(now.getTime() + LEASE_MS);
      tx.update(ref, {
        status: 'processing',
        leaseToken: token,
        leaseUntil,
        nextAttemptAt: leaseUntil,
      });
      return data;
    });
    if (!job) return false;
    try {
      // A restored product or historical order needs investigation, never automatic erasure.
      const [product, orders, reports] = await Promise.all([
        this.db.collection('products').doc(id).get(),
        this.db.collection('orders').where('productId', '==', id).get(),
        this.db.collection('reports').where('targetId', '==', id).get(),
      ]);
      if (
        product.exists ||
        orders.docs.some(
          (doc) =>
            doc.get('status') !== 'cancelled' ||
            doc.get('paymentStatus') !== 'cancelled',
        ) ||
        reports.docs.some(
          (doc) =>
            doc.get('targetType') === 'product' &&
            !['resolved', 'rejected'].includes(doc.get('status')),
        )
      ) {
        await this.finish(ref, token, {
          status: 'review',
          lastError: 'RETAINED_REFERENCE',
        });
        return true;
      }

      // At most 1000 likes per invocation. New likes cannot commit once the product is absent.
      let likesDone = job.likesDone === true;
      for (let page = 0; !likesDone && page < 5; page++) {
        await this.renew(ref, token);
        const likes = await this.db
          .collection('user_likes')
          .where('productId', '==', id)
          .limit(200)
          .get();
        const batch = this.db.batch();
        likes.docs.forEach((doc) => batch.delete(doc.ref));
        if (!likes.empty) await batch.commit();
        likesDone = likes.size < 200;
      }
      if (!likesDone) {
        await this.finish(ref, token, {
          status: 'pending',
          nextAttemptAt: new Date(this.now().getTime() + 1000),
        });
        return true;
      }
      await this.renew(ref, token, { likesDone: true });
      const photos: MediaObject[] = job.photos ?? [];
      if (photos.length && date(job.notBefore) > this.now()) {
        await this.finish(ref, token, {
          status: 'waiting',
          nextAttemptAt: date(job.notBefore),
        });
        return true;
      }
      if (
        photos.length &&
        (this.env.LISTING_CLEANUP_STORAGE_ENABLED !== 'true' ||
          this.env.LISTING_CLEANUP_REFERENCES_VERIFIED !== 'true' ||
          this.env.LISTING_MEDIA_RULES_VERIFIED !== 'true')
      ) {
        await this.finish(ref, token, {
          status: 'waiting',
          lastError: 'STORAGE_CLEANUP_DISABLED',
          nextAttemptAt: new Date(this.now().getTime() + DAY_MS),
        });
        return true;
      }

      let review = job.unverifiedPhotos > 0;
      let shared = false;
      for (const photo of photos) {
        await this.renew(ref, token);
        const result = await this.cleanPhoto(ref, token, job.ownerUid, photo);
        review ||= result === 'review';
        shared ||= result === 'shared';
      }
      await this.releaseRetiring(ref, token, photos);
      if (review)
        await this.finish(ref, token, {
          status: 'review',
          lastError: 'MEDIA_REVIEW_REQUIRED',
        });
      else if (shared)
        await this.finish(ref, token, {
          status: 'waiting',
          nextAttemptAt: new Date(this.now().getTime() + 7 * DAY_MS),
          lastError: 'MEDIA_STILL_REFERENCED',
        });
      else
        await this.finish(ref, token, {
          status: 'completed',
          completedAt: this.now(),
          nextAttemptAt: new Date(this.now().getTime() + RECEIPT_RETENTION_MS),
          photos: FieldValue.delete(),
          unverifiedPhotos: FieldValue.delete(),
          lastError: FieldValue.delete(),
        });
      return true;
    } catch (error) {
      if ((error as Error).message === 'LEASE_LOST') return false;
      await this.releaseRetiring(ref, token, job.photos ?? []);
      const attempts = (job.attempts ?? 0) + 1;
      const lastError = safeErrors.has((error as Error).message)
        ? (error as Error).message
        : 'CLEANUP_FAILED';
      const needsReview =
        attempts >= MAX_ATTEMPTS || lastError === 'STORAGE_GENERATION_CHANGED';
      await this.finish(ref, token, {
        attempts,
        lastError,
        status: needsReview ? 'review' : 'pending',
        ...(needsReview
          ? {}
          : {
              nextAttemptAt: new Date(
                this.now().getTime() + Math.min(DAY_MS, 60_000 * 2 ** attempts),
              ),
            }),
      });
      return true;
    }
  }

  private async cleanPhoto(
    ref: FirebaseFirestore.DocumentReference,
    token: string,
    ownerUid: string,
    photo: MediaObject,
  ): Promise<'done' | 'review' | 'shared'> {
    const generation = await this.storage.inspect(photo, ownerUid);
    if (generation === 'review') return 'review';
    const lock = this.db.collection(MEDIA_RETIREMENTS).doc(mediaKey(photo));
    const acquired = await this.db.runTransaction(async (tx) => {
      await this.assertLease(tx, ref, token);
      const doc = await tx.get(lock);
      const data = doc.data();
      if (data?.state === 'retired')
        return { state: 'retired', generation: data.generation as string };
      if (data?.state === 'retiring' && data.jobId !== ref.id)
        return { state: 'busy' };
      tx.set(lock, { state: 'retiring', jobId: ref.id, leaseToken: token });
      return { state: 'retiring' };
    });
    if (acquired.state === 'busy') return 'shared';
    if (acquired.state === 'retired') {
      if (generation === 'missing') return 'done';
      if (generation !== acquired.generation) return 'review';
      await this.storage.remove(photo, generation);
      return 'done';
    }

    // Retirement is visible to every create/edit transaction before scanning.
    // Bounded scans cover canonical aliases and older data without new indexes or unsafe backfills.
    let used = false;
    let incomplete = false;
    for (const collection of ['products', 'orders']) {
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      let seen = 0;
      while (seen < SCAN_LIMIT) {
        await this.renew(ref, token);
        let query = this.db
          .collection(collection)
          .orderBy(FieldPath.documentId())
          .limit(200);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        if (page.docs.some((doc) => referencesMedia(doc.data(), photo))) {
          used = true;
          break;
        }
        seen += page.size;
        if (page.size < 200) break;
        cursor = page.docs[page.docs.length - 1];
        if (seen >= SCAN_LIMIT) incomplete = true;
      }
      if (used) break;
    }
    await this.db.runTransaction(async (tx) => {
      await this.assertLease(tx, ref, token);
      const doc = await tx.get(lock);
      if (doc.get('leaseToken') !== token) throw new Error('LEASE_LOST');
      if (used || incomplete) tx.delete(lock);
      else tx.set(lock, { state: 'retired', generation });
    });
    if (used) return 'shared';
    if (incomplete) return 'review';
    if (generation !== 'missing') await this.storage.remove(photo, generation);
    return 'done';
  }

  private async releaseRetiring(
    ref: FirebaseFirestore.DocumentReference,
    token: string,
    photos: MediaObject[],
  ) {
    await this.db.runTransaction(async (tx) => {
      await this.assertLease(tx, ref, token);
      const locks = await Promise.all(
        photos.map((photo) =>
          tx.get(this.db.collection(MEDIA_RETIREMENTS).doc(mediaKey(photo))),
        ),
      );
      for (const lock of locks) {
        // Only a temporary retirement can be released. Once deletion is possible,
        // its permanent marker prevents stale writers attaching that object again.
        if (lock.get('state') === 'retiring' && lock.get('jobId') === ref.id)
          tx.delete(lock.ref);
      }
    });
  }

  private async assertLease(
    tx: FirebaseFirestore.Transaction,
    ref: FirebaseFirestore.DocumentReference,
    token: string,
  ) {
    const doc = await tx.get(ref);
    if (
      !doc.exists ||
      doc.get('leaseToken') !== token ||
      date(doc.get('leaseUntil')) <= this.now()
    )
      throw new Error('LEASE_LOST');
  }

  private async renew(
    ref: FirebaseFirestore.DocumentReference,
    token: string,
    extra: Record<string, unknown> = {},
  ) {
    await this.db.runTransaction(async (tx) => {
      await this.assertLease(tx, ref, token);
      const leaseUntil = new Date(this.now().getTime() + LEASE_MS);
      tx.update(ref, { ...extra, leaseUntil, nextAttemptAt: leaseUntil });
    });
  }

  private async finish(
    ref: FirebaseFirestore.DocumentReference,
    token: string,
    updates: Record<string, unknown>,
  ) {
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get('leaseToken') !== token) return;
      tx.update(ref, {
        nextAttemptAt: FieldValue.delete(),
        leaseToken: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        ...updates,
      });
    });
  }
}
