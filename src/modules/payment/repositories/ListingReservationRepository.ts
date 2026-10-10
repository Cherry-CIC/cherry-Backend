import type { Firestore } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import {
  ListingSafetyError,
  requireVersion,
} from '../../../shared/utils/listingSafety';

export const RESERVATION_COLLECTION = 'listing_payment_reservations';
export const RESERVATION_LIFETIME_MS = 30 * 60 * 1000;
// Stripe retains idempotency keys for at least 24 hours. Never create again after this window.
export const SAFE_STRIPE_RETRY_MS = 23 * 60 * 60 * 1000;

export interface ListingReservation {
  id: string;
  productId: string;
  userId: string;
  customerId: string;
  selectionKey: string;
  reviewedVersion: number;
  reservedVersion: number;
  metadata: Record<string, string>;
  totalAmount: number;
  state: 'creating' | 'active' | 'succeeded' | 'cancelled' | 'completed';
  createdAtMs: number;
  expiresAtMs: number;
  paymentIntentId?: string;
}

export class ListingReservationRepository {
  constructor(private readonly db: Firestore = firestore) {}

  async activeForProduct(
    productId: string,
  ): Promise<ListingReservation | null> {
    const product = await this.db.collection('products').doc(productId).get();
    const id = product.data()?.paymentReservationId;
    return typeof id === 'string' && id ? this.get(id) : null;
  }

  async get(id: string): Promise<ListingReservation | null> {
    const doc = await this.db.collection(RESERVATION_COLLECTION).doc(id).get();
    return doc.exists
      ? ({ ...doc.data(), id: doc.id } as ListingReservation)
      : null;
  }

  async reserve(input: {
    productId: string;
    userId: string;
    customerId: string;
    expectedEditVersion?: number;
    selectionKey: string;
    quotedVersion: number;
    quotedPrice: number;
    quotedPostageSize: string;
    metadata: Record<string, string>;
    totalAmount: number;
  }): Promise<ListingReservation> {
    const ref = this.db.collection(RESERVATION_COLLECTION).doc();
    const productRef = this.db.collection('products').doc(input.productId);
    return this.db.runTransaction(async (tx) => {
      const productDoc = await tx.get(productRef);
      if (!productDoc.exists)
        throw new ListingSafetyError(
          404,
          'LISTING_NOT_FOUND',
          'Listing not found',
        );
      const product = productDoc.data()!;
      const accountDocs = await Promise.all([
        tx.get(this.db.collection('account_deletions').doc(input.userId)),
        tx.get(this.db.collection('account_deletions').doc(product.userId)),
      ]);
      if (accountDocs.some((doc) => doc.exists))
        throw new ListingSafetyError(
          409,
          'ACCOUNT_DELETION_PENDING',
          'Account deletion is in progress.',
        );

      const version =
        product.editVersion === undefined ? 0 : requireVersion(product);
      if (
        input.expectedEditVersion === undefined &&
        product.hasBeenEdited === true
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_REQUIRED',
          'Refresh this listing before paying',
        );
      }
      if (
        input.expectedEditVersion !== undefined &&
        (!Number.isSafeInteger(input.expectedEditVersion) ||
          input.expectedEditVersion < 0)
      ) {
        throw new ListingSafetyError(
          400,
          'INVALID_EDIT_VERSION',
          'expectedEditVersion must be a non-negative integer',
        );
      }
      if (product.paymentReservationId) {
        const existingDoc = await tx.get(
          this.db
            .collection(RESERVATION_COLLECTION)
            .doc(product.paymentReservationId),
        );
        const existing = existingDoc.data() as ListingReservation | undefined;
        if (
          existing &&
          existing.userId === input.userId &&
          existing.selectionKey === input.selectionKey &&
          ['creating', 'active'].includes(existing.state) &&
          (input.expectedEditVersion === undefined ||
            [existing.reviewedVersion, existing.reservedVersion].includes(
              input.expectedEditVersion,
            ))
        ) {
          return { ...existing, id: existingDoc.id };
        }
        throw new ListingSafetyError(
          409,
          'LISTING_PAYMENT_PENDING',
          'A payment is already in progress for this listing',
        );
      }
      if (
        input.expectedEditVersion !== undefined &&
        version !== input.expectedEditVersion
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_CONFLICT',
          'This listing has changed. Refresh it before paying',
        );
      }
      if (
        !Number.isSafeInteger(product.number) ||
        product.number <= 0 ||
        (product.status !== undefined && product.status !== 'active')
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_NOT_AVAILABLE',
          'This listing is not available',
        );
      }
      if (product.userId === input.userId)
        throw new ListingSafetyError(
          403,
          'LISTING_SELF_PURCHASE',
          'You cannot buy your own listing',
        );
      if (
        version !== input.quotedVersion ||
        product.price !== input.quotedPrice ||
        product.postageSize !== input.quotedPostageSize
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_CONFLICT',
          'This listing has changed. Refresh it before paying',
        );
      }
      const now = Date.now();
      const reservation: ListingReservation = {
        id: ref.id,
        productId: input.productId,
        userId: input.userId,
        customerId: input.customerId,
        selectionKey: input.selectionKey,
        reviewedVersion: version,
        reservedVersion: version + 1,
        metadata: {
          ...input.metadata,
          listingReservationId: ref.id,
          listingEditVersion: String(version),
        },
        totalAmount: input.totalAmount,
        state: 'creating',
        createdAtMs: now,
        expiresAtMs: now + RESERVATION_LIFETIME_MS,
      };
      tx.set(ref, reservation);
      tx.update(productRef, {
        paymentReservationId: ref.id,
        editVersion: version + 1,
        updatedAt: new Date(now),
      });
      return reservation;
    });
  }

  async attachIntent(
    reservation: ListingReservation,
    paymentIntentId: string,
  ): Promise<void> {
    const ref = this.db.collection(RESERVATION_COLLECTION).doc(reservation.id);
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const current = doc.data() as ListingReservation;
      if (
        !current ||
        (current.paymentIntentId && current.paymentIntentId !== paymentIntentId)
      ) {
        throw new ListingSafetyError(
          409,
          'PAYMENT_RESERVATION_MISMATCH',
          'Payment reservation does not match',
        );
      }
      tx.update(ref, {
        paymentIntentId,
        state: current.state === 'creating' ? 'active' : current.state,
      });
    });
  }

  // Only call using a freshly retrieved Stripe object or a signature-verified webhook.
  async applyStripeState(intent: {
    id: string;
    status: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    if (!['succeeded', 'canceled'].includes(intent.status)) return;
    const { productId, listingReservationId, firebaseUid } = intent.metadata;
    if (!productId) return; // Unrelated Stripe payment.
    const productRef = this.db.collection('products').doc(productId);
    const eventRef = this.db
      .collection('listing_payment_states')
      .doc(intent.id);
    await this.db.runTransaction(async (tx) => {
      const [productDoc, eventDoc] = await Promise.all([
        tx.get(productRef),
        tx.get(eventRef),
      ]);
      // A cancelled listing may legitimately be deleted before webhook retries.
      // Already applied terminal events need no surviving product document.
      if (
        eventDoc.data()?.status === 'succeeded' ||
        eventDoc.data()?.status === intent.status
      )
        return;
      if (!productDoc.exists)
        throw new Error('Payment listing is missing; reconciliation required');
      const product = productDoc.data()!;
      const reservationRef = listingReservationId
        ? this.db.collection(RESERVATION_COLLECTION).doc(listingReservationId)
        : null;
      const reservation = reservationRef
        ? ((await tx.get(reservationRef)).data() as
            ListingReservation | undefined)
        : undefined;
      if (
        reservationRef &&
        (!reservation ||
          reservation.productId !== productId ||
          reservation.userId !== firebaseUid ||
          (reservation.paymentIntentId &&
            reservation.paymentIntentId !== intent.id))
      ) {
        throw new Error(
          'Payment reservation mismatch; reconciliation required',
        );
      }
      if (
        reservation?.state === 'completed' ||
        reservation?.state === 'succeeded'
      )
        return;
      const version =
        product.editVersion === undefined ? 0 : requireVersion(product);
      if (intent.status === 'succeeded') {
        tx.update(productRef, {
          hasSales: true,
          editVersion: version + 1,
          updatedAt: new Date(),
        });
      } else if (
        reservation &&
        product.paymentReservationId === listingReservationId
      ) {
        tx.update(productRef, {
          paymentReservationId: null,
          editVersion: version + 1,
          updatedAt: new Date(),
        });
      }
      if (reservationRef)
        tx.update(reservationRef, {
          paymentIntentId: intent.id,
          state: intent.status === 'succeeded' ? 'succeeded' : 'cancelled',
        });
      tx.set(eventRef, {
        status: intent.status,
        productId,
        updatedAt: new Date(),
      });
    });
  }
}
