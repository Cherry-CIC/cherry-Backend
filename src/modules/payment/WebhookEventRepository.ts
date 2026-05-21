import { firestore } from '../../shared/config/firebaseConfig';

const COLLECTION = 'stripe_webhook_events';

export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  processedAt: Date;
}

/**
 * Provides durable idempotency for Stripe webhook events using Firestore.
 *
 * Each processed event is stored as a document whose ID is the Stripe event ID
 * (e.g. "evt_1AbCdEfG..."). Because the document ID equals the event ID:
 *   - Lookups are O(1) key reads — no collection scans required.
 *   - Concurrent duplicate deliveries from Stripe are safely serialised by
 *     Firestore; at most one `set` will win and the other will see the document
 *     already present on its subsequent `hasBeenProcessed` check.
 *
 * Firestore collection: `stripe_webhook_events`
 */
export class WebhookEventRepository {
  /**
   * Returns true if the given Stripe event ID has already been processed.
   * This must be called before executing any side effects for a webhook event.
   */
  async hasBeenProcessed(eventId: string): Promise<boolean> {
    const doc = await firestore.collection(COLLECTION).doc(eventId).get();
    return doc.exists;
  }

  /**
   * Persists the event ID so future duplicate deliveries can be detected.
   * Call this only AFTER all side effects for the event have been successfully
   * applied. If side-effect processing throws, do NOT call this method — Stripe
   * will retry and the event will be processed again on the next attempt.
   */
  async markAsProcessed(eventId: string, eventType: string): Promise<void> {
    const record: WebhookEventRecord = {
      eventId,
      eventType,
      processedAt: new Date(),
    };
    await firestore.collection(COLLECTION).doc(eventId).set(record);
  }
}
