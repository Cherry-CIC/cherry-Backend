import { firestore } from '../../shared/config/firebaseConfig';

const COLLECTION = 'stripe_webhook_events';

/**
 * How long (milliseconds) a 'processing' claim is considered live before a
 * subsequent delivery may steal it. Stripe's own retry window is several hours,
 * so 5 minutes gives healthy processing time while still recovering from
 * crashed workers. Override via WEBHOOK_CLAIM_TTL_MS env var.
 */
const CLAIM_TTL_MS =
  Number(process.env.WEBHOOK_CLAIM_TTL_MS) || 5 * 60 * 1_000; // 5 min

export type WebhookEventStatus = 'processing' | 'processed';

/**
 * Result codes returned by `claim()`:
 *
 * - `'claimed'`           — This delivery atomically acquired the lock; caller
 *                           must process the event and then call markAsProcessed,
 *                           or releaseClaim on failure.
 * - `'already_processed'` — A previous delivery fully processed the event; the
 *                           caller must treat it as a duplicate and skip all side
 *                           effects.
 * - `'in_progress'`       — Another delivery holds an unexpired lease; the caller
 *                           must treat it as a duplicate (Stripe will retry and
 *                           may win the takeover on a later attempt).
 */
export type ClaimResult = 'claimed' | 'already_processed' | 'in_progress';

export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  status: WebhookEventStatus;
  /** Wall-clock time this delivery first wrote the claim row. */
  receivedAt: Date;
  processedAt?: Date;
  /**
   * Updated each time a delivery (re-)claims the row.  Used to evaluate lease
   * staleness on subsequent ALREADY_EXISTS conflicts.
   */
  claimedAt: Date;
}

/**
 * Provides durable, race-safe idempotency for Stripe webhook events using Firestore.
 *
 * Each event is stored as a document whose ID is the Stripe event ID (e.g.
 * "evt_1AbCdEfG..."). The document ID equals the event ID, so lookups and claims
 * are O(1) key operations — no collection scans.
 *
 * Concurrency model:
 *   - `claim(eventId, eventType)` uses Firestore `.create()`, which atomically
 *     fails when the document already exists. Two concurrent webhook deliveries
 *     of the same event therefore cannot both succeed in claiming — the loser
 *     receives a thrown error and must inspect the existing row.
 *   - On ALREADY_EXISTS the loser reads the document and branches:
 *       • status === 'processed'  → return 'already_processed' (skip all effects).
 *       • status === 'processing' and claimedAt is fresh → return 'in_progress'
 *         (another worker holds a valid lease; Stripe will retry later).
 *       • status === 'processing' and claimedAt is stale → attempt a conditional
 *         takeover via a Firestore transaction; if the takeover succeeds return
 *         'claimed'; if another delivery beat us to the takeover return
 *         'in_progress'.
 *   - `markAsProcessed` is called ONLY after side effects succeed; it flips the
 *     document status from 'processing' → 'processed'.
 *   - `releaseClaim` resets a claim whose side effects failed so Stripe retries
 *     can re-acquire it (deletes the row; `.create()` on retry works again).
 *
 * Firestore collection: `stripe_webhook_events`
 */
export class WebhookEventRepository {
  /**
   * Atomically attempts to claim the given Stripe event ID for processing.
   *
   * Returns a `ClaimResult`:
   *   - `'claimed'`           — caller must process then markAsProcessed / releaseClaim.
   *   - `'already_processed'` — terminal duplicate; skip all side effects.
   *   - `'in_progress'`       — another delivery holds a live lease; skip side effects.
   */
  async claim(eventId: string, eventType: string): Promise<ClaimResult> {
    const now = new Date();
    const record: WebhookEventRecord = {
      eventId,
      eventType,
      status: 'processing',
      receivedAt: now,
      claimedAt: now,
    };

    try {
      await firestore.collection(COLLECTION).doc(eventId).create(record);
      return 'claimed';
    } catch (err: any) {
      // Firestore admin SDK raises ALREADY_EXISTS (gRPC code 6) when create()
      // is called on an existing document. Any other error must propagate so the
      // controller can return 500 and let Stripe retry.
      if (!(err && (err.code === 6 || err.code === 'already-exists'))) {
        throw err;
      }
    }

    // ── ALREADY_EXISTS path ──────────────────────────────────────────────────
    // Another delivery (or a previous attempt) created the row first. Read it
    // to decide whether we can take over, must yield, or can skip entirely.
    const snap = await firestore.collection(COLLECTION).doc(eventId).get();

    if (!snap.exists) {
      // Document vanished between the failed create() and the get() — extremely
      // rare (concurrent releaseClaim). Treat as "not yet claimed" and let the
      // caller retry; propagate as an error so Stripe retries delivery.
      throw new Error(
        `WebhookEventRepository: document ${eventId} disappeared during claim read`,
      );
    }

    const existing = snap.data() as WebhookEventRecord;

    if (existing.status === 'processed') {
      return 'already_processed';
    }

    // status === 'processing': check lease age.
    const leaseAge =
      now.getTime() -
      (existing.claimedAt instanceof Date
        ? existing.claimedAt.getTime()
        : (existing.claimedAt as any).toDate().getTime());

    if (leaseAge < CLAIM_TTL_MS) {
      // Lease is still fresh — another worker is actively processing.
      return 'in_progress';
    }

    // Stale lease: attempt a conditional takeover inside a transaction so that
    // two concurrent takeover attempts cannot both win.
    const docRef = firestore.collection(COLLECTION).doc(eventId);
    try {
      const tookOver = await firestore.runTransaction(async (tx) => {
        const txSnap = await tx.get(docRef);
        if (!txSnap.exists) {
          // Vanished mid-flight — treat as lost; the caller should retry.
          return false;
        }
        const txData = txSnap.data() as WebhookEventRecord;
        if (txData.status === 'processed') {
          // Another delivery finished while we were spinning — yield.
          return false;
        }
        // Re-check staleness inside the transaction to avoid a race between
        // two simultaneous takeover attempts.
        const txAge =
          now.getTime() -
          (txData.claimedAt instanceof Date
            ? txData.claimedAt.getTime()
            : (txData.claimedAt as any).toDate().getTime());
        if (txAge < CLAIM_TTL_MS) {
          // Another delivery renewed the lease between our read and here.
          return false;
        }
        tx.update(docRef, {
          status: 'processing',
          claimedAt: now,
        } satisfies Partial<WebhookEventRecord>);
        return true;
      });

      return tookOver ? 'claimed' : 'in_progress';
    } catch (txErr: any) {
      // Transaction failure (e.g. contention abort) — be conservative and
      // yield; the next Stripe retry can attempt the takeover again.
      console.warn(
        `[WebhookEventRepository] Takeover transaction failed for ${eventId}:`,
        txErr,
      );
      return 'in_progress';
    }
  }

  /**
   * Marks an event whose claim was acquired as fully processed. Call this only
   * AFTER all side effects for the event have been successfully applied.
   */
  async markAsProcessed(eventId: string, eventType: string): Promise<void> {
    await firestore.collection(COLLECTION).doc(eventId).update({
      eventType,
      status: 'processed',
      processedAt: new Date(),
    });
  }

  /**
   * Removes a claim row whose side-effect processing failed. Stripe will retry
   * the webhook, and the retry will be free to claim the event again via
   * `.create()`. Must be called whenever business logic throws after a
   * successful `claim()`.
   */
  async releaseClaim(eventId: string): Promise<void> {
    await firestore.collection(COLLECTION).doc(eventId).delete();
  }
}
