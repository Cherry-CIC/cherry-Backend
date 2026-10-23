import { createHash } from 'crypto';
import { firestore } from '../shared/config/firebaseConfig';
import { OrderDisputeReason } from '../modules/order/model/Order';
import {
  evaluatePayoutRelease,
  toDateOrNull,
} from '../modules/order/services/payoutRelease';
import { FieldValue } from 'firebase-admin/firestore';
import {
  addHoldReason,
  getActiveHoldReasons,
  holdReasonFields,
  removeHoldReason,
} from '../modules/order/services/holdReasons';
import {
  NewPayoutEvent,
  recordPayoutEvent,
} from '../modules/order/services/payoutEvents';
import {
  AdminModerationStatus,
  DISPUTE_STATUSES,
  Dispute,
  DisputeAdminError,
  DisputeEvent,
  DisputeResolutionOutcome,
  DisputeStatus,
  DisputeSubmissionError,
} from './Dispute';

export interface CreateBuyerDisputeInput {
  orderId: string;
  buyerId: string;
  reason: OrderDisputeReason;
  message?: string;
}

export interface ListDisputesInput {
  status?: DisputeStatus;
  limit: number;
  cursor?: string;
}

export interface ListDisputesResult {
  disputes: Dispute[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DisputeDetails {
  dispute: Dispute;
  events: DisputeEvent[];
}

const ALLOWED_ADMIN_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  raised: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: [],
};

const toDate = (value: unknown): Date => {
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

const mapDispute = (
  id: string,
  data: FirebaseFirestore.DocumentData,
): Dispute => ({
  ...data,
  disputeId: id,
  createdAt: toDate(data.createdAt),
  updatedAt: toDate(data.updatedAt),
  ...(data.claimedAt ? { claimedAt: toDate(data.claimedAt) } : {}),
  ...(data.resolution
    ? { resolution: { ...data.resolution, resolvedAt: toDate(data.resolution.resolvedAt) } }
    : {}),
}) as Dispute;

export class DisputeRepository {
  async createBuyerDispute(input: CreateBuyerDisputeInput): Promise<Dispute> {
    const orderRef = firestore.collection('orders').doc(input.orderId);
    const disputes = firestore.collection('disputes');
    let disputeRef = disputes.doc();
    while (disputeRef.id === input.orderId) {
      disputeRef = disputes.doc();
    }
    const eventRef = disputeRef.collection('events').doc();

    return firestore.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists) {
        throw new DisputeSubmissionError('order_not_found');
      }

      const order = orderSnapshot.data()!;
      if (order.userId !== input.buyerId) {
        throw new DisputeSubmissionError('not_order_owner');
      }

      if (
        order.buyerDisputeStatus ||
        (order.status !== 'delivered' && order.shipmentStatus !== 'delivered')
      ) {
        throw new DisputeSubmissionError('order_not_eligible');
      }

      // The window ends on confirmation, on release, or at releaseAt even if
      // the release task has not run yet.
      const releaseAt = toDateOrNull(order.releaseAt);
      const submittedAt = new Date();
      if (
        order.buyerConfirmedReceived ||
        order.payoutStatus === 'ready_for_payout' ||
        (releaseAt && releaseAt.getTime() <= submittedAt.getTime())
      ) {
        throw new DisputeSubmissionError('dispute_window_closed');
      }

      const productSnapshot = await transaction.get(
        firestore.collection('products').doc(order.productId),
      );
      const sellerId = productSnapshot.data()?.userId;
      if (typeof sellerId !== 'string') {
        throw new Error('Seller not found for dispute order');
      }
      const now = new Date();
      const dispute: Dispute = {
        disputeId: disputeRef.id,
        orderId: input.orderId,
        buyerId: input.buyerId,
        sellerId,
        productId: order.productId,
        productName: order.productName,
        reason: input.reason,
        ...(input.message ? { message: input.message } : {}),
        status: 'raised',
        orderSnapshot: {
          totalAmount: order.totalAmount,
          currency: order.currency,
          paymentIntentId: order.paymentIntentId,
          orderStatus: order.status,
          shipmentStatus: order.shipmentStatus,
        },
        evidence: [],
        createdAt: now,
        updatedAt: now,
      };

      transaction.create(disputeRef, dispute);
      transaction.create(eventRef, {
        type: 'submitted',
        actorId: input.buyerId,
        actorRole: 'buyer',
        fromStatus: null,
        toStatus: 'raised',
        createdAt: now,
      });
      transaction.update(orderRef, {
        buyerDisputeId: dispute.disputeId,
        buyerDisputeReason: dispute.reason,
        buyerDisputeStatus: 'raised',
        ...(dispute.message ? { buyerDisputeMessage: dispute.message } : {}),
        buyerDisputedAt: now,
        // Blocks both buyer confirmation and the expiry task from releasing funds.
        ...(order.payoutStatus === 'held'
          ? {
              ...holdReasonFields(
                addHoldReason(getActiveHoldReasons(order), 'dispute'),
              ),
              autoReleaseAt: FieldValue.delete(),
            }
          : {}),
      });
      if (order.payoutStatus === 'held') {
        recordPayoutEvent(
          transaction,
          orderRef,
          {
            type: 'hold_placed',
            actorRole: 'buyer',
            actorId: input.buyerId,
            fromStatus: 'held',
            toStatus: 'held',
            reason: 'dispute',
          },
          now,
        );
      }

      return dispute;
    });
  }

  async getStatusCounts(): Promise<Record<DisputeStatus, number>> {
    const counts = await Promise.all(
      DISPUTE_STATUSES.map(async (status) => {
        const result = await firestore
          .collection('disputes')
          .where('status', '==', status)
          .count()
          .get();
        return [status, result.data().count] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<DisputeStatus, number>;
  }

  async listDisputes(input: ListDisputesInput): Promise<ListDisputesResult> {
    const collection = firestore.collection('disputes');
    let query = input.status
      ? collection.where('status', '==', input.status)
      : collection;
    query = query.orderBy('createdAt', 'desc');

    if (input.cursor) {
      const cursorSnapshot = await collection.doc(input.cursor).get();
      if (!cursorSnapshot.exists) {
        throw new DisputeAdminError('cursor_not_found');
      }
      query = query.startAfter(cursorSnapshot);
    }

    const snapshot = await query.limit(input.limit + 1).get();
    const hasMore = snapshot.docs.length > input.limit;
    const page = snapshot.docs.slice(0, input.limit);
    return {
      disputes: page.map((doc) => mapDispute(doc.id, doc.data())),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  async getDisputeDetails(disputeId: string): Promise<DisputeDetails | null> {
    const disputeRef = firestore.collection('disputes').doc(disputeId);
    const [disputeSnapshot, eventsSnapshot] = await Promise.all([
      disputeRef.get(),
      disputeRef.collection('events').orderBy('createdAt', 'asc').get(),
    ]);
    if (!disputeSnapshot.exists) {
      return null;
    }

    return {
      dispute: mapDispute(disputeSnapshot.id, disputeSnapshot.data()!),
      events: eventsSnapshot.docs.map((doc) => ({
        ...doc.data(),
        eventId: doc.id,
        createdAt: toDate(doc.data().createdAt),
      })) as DisputeEvent[],
    };
  }

  async getDisputeDetailsByOrderId(
    orderId: string,
  ): Promise<DisputeDetails | null> {
    const snapshot = await firestore
      .collection('disputes')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return null;
    }
    return this.getDisputeDetails(snapshot.docs[0].id);
  }

  async moderateDispute(
    disputeId: string,
    adminId: string,
    status: AdminModerationStatus,
    note: string | undefined,
    idempotencyKey: string,
    outcome?: DisputeResolutionOutcome,
  ): Promise<Dispute> {
    const disputeRef = firestore.collection('disputes').doc(disputeId);
    const eventRef = disputeRef.collection('events').doc();
    const idempotencyRef = disputeRef
      .collection('idempotency_keys')
      .doc(createHash('sha256').update(idempotencyKey).digest('hex'));
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          adminId,
          status,
          note: note ?? null,
          ...(outcome ? { outcome } : {}),
        }),
      )
      .digest('hex');

    return firestore.runTransaction(async (transaction) => {
      const [snapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(disputeRef),
        transaction.get(idempotencyRef),
      ]);
      if (!snapshot.exists) {
        throw new DisputeAdminError('dispute_not_found');
      }

      const current = mapDispute(snapshot.id, snapshot.data()!);
      if (idempotencySnapshot.exists) {
        const previousRequest = idempotencySnapshot.data()!;
        if (previousRequest.requestHash !== requestHash) {
          throw new DisputeAdminError('idempotency_key_reused');
        }
        return mapDispute(disputeId, previousRequest.result);
      }

      const orderRef = firestore.collection('orders').doc(current.orderId);
      const orderSnapshot = await transaction.get(orderRef);
      if (!ALLOWED_ADMIN_TRANSITIONS[current.status].includes(status)) {
        throw new DisputeAdminError('invalid_status_transition');
      }

      const now = new Date();
      const orderUpdates: Record<string, unknown> = { buyerDisputeStatus: status };
      let payoutEvent: NewPayoutEvent | null = null;
      if (status === 'resolved' && outcome && orderSnapshot.exists) {
        const orderData = orderSnapshot.data()!;
        if (outcome === 'release_to_charity') {
          const paymentSnapshot =
            typeof orderData.paymentIntentId === 'string'
              ? await transaction.get(
                  firestore.collection('payments').doc(orderData.paymentIntentId),
                )
              : null;
          const decision = evaluatePayoutRelease({
            order: orderData,
            payment: paymentSnapshot?.exists ? paymentSnapshot.data()! : null,
            trigger: 'dispute_resolution',
            now,
          });
          if (decision.canRelease) {
            Object.assign(orderUpdates, {
              payoutStatus: 'ready_for_payout',
              readyForPayoutAt: now,
              payoutReleaseTrigger: 'dispute_resolution',
              ...holdReasonFields([]),
              autoReleaseAt: FieldValue.delete(),
            });
            payoutEvent = {
              type: 'released',
              actorRole: 'admin',
              actorId: adminId,
              fromStatus: 'held',
              toStatus: 'ready_for_payout',
              trigger: 'dispute_resolution',
              note,
            };
          } else if (
            decision.result.status === 'blocked' &&
            decision.result.reason !== 'not_held'
          ) {
            throw new DisputeAdminError('release_blocked');
          }
        } else if (orderData.payoutStatus === 'held') {
          // Refund execution is separate; the funds just stay held. The dispute
          // hold ends with its resolution; any other active hold is kept.
          Object.assign(
            orderUpdates,
            holdReasonFields(
              addHoldReason(
                removeHoldReason(getActiveHoldReasons(orderData), 'dispute'),
                'refund',
              ),
            ),
          );
          orderUpdates.autoReleaseAt = FieldValue.delete();
          payoutEvent = {
            type: 'hold_placed',
            actorRole: 'admin',
            actorId: adminId,
            fromStatus: 'held',
            toStatus: 'held',
            reason: 'refund',
            note,
          };
        }
      }

      const updates: Record<string, unknown> = {
        status,
        updatedAt: now,
      };
      if (status === 'in_progress' && !current.assignedAdminId) {
        updates.assignedAdminId = adminId;
        updates.claimedAt = now;
      }
      if (status === 'resolved') {
        if (!current.assignedAdminId) {
          updates.assignedAdminId = adminId;
        }
        updates.resolution = {
          note: note!,
          ...(outcome ? { outcome } : {}),
          resolvedBy: adminId,
          resolvedAt: now,
        };
      }

      const result = { ...current, ...updates } as Dispute;
      transaction.update(disputeRef, updates);
      transaction.create(eventRef, {
        type: 'status_changed',
        actorId: adminId,
        actorRole: 'admin',
        fromStatus: current.status,
        toStatus: status,
        ...(note ? { note } : {}),
        createdAt: now,
      });
      transaction.create(idempotencyRef, {
        requestHash,
        result,
        createdAt: now,
      });
      if (orderSnapshot.exists) {
        transaction.update(orderRef, orderUpdates);
        if (payoutEvent) {
          recordPayoutEvent(transaction, orderRef, payoutEvent, now);
        }
      }

      return result;
    });
  }
}
