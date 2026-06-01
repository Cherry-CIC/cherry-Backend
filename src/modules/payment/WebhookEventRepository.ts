import { firestore } from '../../shared/config/firebaseConfig';

const COLLECTION = 'stripe_webhook_events';

export type WebhookEventStatus = 'processing' | 'processed';

export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  status: WebhookEventStatus;
  receivedAt: Date;
  processedAt?: Date;
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
 *     receives a thrown error and must treat the event as a duplicate. This is
 *     the SOLE primitive used to gate side effects; never gate on a separate
 *     read-then-write because that pattern admits a race window.
 *   - `markAsProcessed` is called ONLY after side effects succeed; it flips the
 *     document status from 'processing' → 'processed'.
 *   - `releaseClaim` deletes a claim that was acquired but whose side effects
 *     failed. This lets Stripe retry the event without the claim row blocking
 *     it. Side effects in WebhookService are themselves idempotent (no-op when
 *     the target state is already set), so a retry is safe.
 *
 * Firestore collection: `stripe_webhook_events`
 */
export class WebhookEventRepository {
  /**
   * Atomically attempts to claim the given Stripe event ID for processing.
   * Returns true if the claim was acquired (caller must process the event and
   * then call markAsProcessed, or releaseClaim on failure). Returns false if
   * another delivery has already claimed or processed this event — the caller
   * must treat it as a duplicate and perform no side effects.
   *
   * Uses Firestore `.create()` which fails atomically if the document exists.
   * This is the only safe way to detect duplicates under concurrent delivery.
   */
  async claim(eventId: string, eventType: string): Promise<boolean> {
    const record: WebhookEventRecord = {
      eventId,
      eventType,
      status: 'processing',
      receivedAt: new Date(),
    };
    try {
      await firestore.collection(COLLECTION).doc(eventId).create(record);
      return true;
    } catch (err: any) {
      // Firestore admin SDK raises ALREADY_EXISTS (code 6) when create() is
      // called on an existing document. Any other error must propagate so the
      // controller can return 500 and let Stripe retry.
      if (err && (err.code === 6 || err.code === 'already-exists')) {
        return false;
      }
      throw err;
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
   * the webhook, and the retry will be free to claim the event again. Must be
   * called whenever business logic throws after a successful `claim()`.
   */
  async releaseClaim(eventId: string): Promise<void> {
    await firestore.collection(COLLECTION).doc(eventId).delete();
  }
}
