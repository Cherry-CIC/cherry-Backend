import { FieldPath } from 'firebase-admin/firestore';
import { holdReasonFields } from './holdReasons';
import { firestore } from '../../../shared/config/firebaseConfig';
import { calculateReleaseAt } from '../../../shared/config/orderReleaseConfig';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { Shipment } from '../../shipping/models/Shipment';
import { recordPayoutEvent } from './payoutEvents';
import { toDateOrNull } from './payoutRelease';

export type BackfillSkipReason = 'already_migrated' | 'not_paid' | 'not_delivered';
export type DeliveredAtSource =
  | 'order'
  | 'shipment'
  | 'buyer_confirmation'
  | 'order_update'
  | 'payment'
  | 'backfill_time';

export type BackfillPlan =
  | { action: 'skip'; reason: BackfillSkipReason }
  | {
      action: 'hold';
      deliveredAt: Date;
      deliveredAtSource: DeliveredAtSource;
      releaseAt: Date;
      // False for disputed orders: an admin decides those.
      autoRelease: boolean;
      holdReason?: 'dispute';
    };

const isDelivered = (order: FirebaseFirestore.DocumentData): boolean =>
  order.status === 'delivered' || order.shipmentStatus === 'delivered';

// Orders delivered before the hold existed have no payoutStatus. They get the
// same hold an order delivered today would, started from the best delivery time
// still known, so a past window simply releases on the next reconciliation run (after
// the usual checks). A buyer confirmation is honoured. Disputed orders stay on a
// dispute hold, because the old dispute flow recorded no outcome.
export const planBackfill = (
  order: FirebaseFirestore.DocumentData,
  shipment: Pick<Shipment, 'status' | 'updatedAt'> | null,
  now: Date,
  holdPeriodHours?: number,
): BackfillPlan => {
  if (order.payoutStatus) {
    return { action: 'skip', reason: 'already_migrated' };
  }
  if (order.paymentStatus !== 'succeeded') {
    return { action: 'skip', reason: 'not_paid' };
  }
  if (!isDelivered(order)) {
    return { action: 'skip', reason: 'not_delivered' };
  }

  const confirmedAt = order.buyerConfirmedReceived
    ? (toDateOrNull(order.buyerConfirmedReceivedAt) ?? now)
    : null;
  const candidates: [Date | null, DeliveredAtSource][] = [
    [toDateOrNull(order.deliveredAt), 'order'],
    [
      shipment?.status === 'delivered' ? toDateOrNull(shipment.updatedAt) : null,
      'shipment',
    ],
    [toDateOrNull(order.buyerConfirmedReceivedAt), 'buyer_confirmation'],
    [toDateOrNull(order.updatedAt), 'order_update'],
    [toDateOrNull(order.paidAt), 'payment'],
  ];
  const [deliveredAt, deliveredAtSource] = candidates.find(
    ([date]) => date !== null,
  ) ?? [now, 'backfill_time' as DeliveredAtSource];

  const disputed = Boolean(order.buyerDisputeId);
  let releaseAt = calculateReleaseAt(deliveredAt!, holdPeriodHours);
  if (confirmedAt && !disputed && confirmedAt.getTime() < releaseAt.getTime()) {
    releaseAt = confirmedAt;
  }

  return {
    action: 'hold',
    deliveredAt: deliveredAt!,
    deliveredAtSource,
    releaseAt,
    autoRelease: !disputed,
    ...(disputed ? { holdReason: 'dispute' as const } : {}),
  };
};

export interface BackfillSummary {
  scanned: number;
  held: number;
  disputed: number;
  skipped: Record<BackfillSkipReason, number>;
  errors: number;
}

export interface BackfillOrderSource {
  listPaidOrders(
    afterId: string | undefined,
    limit: number,
  ): Promise<{ id: string; data: FirebaseFirestore.DocumentData }[]>;
  getShipment(orderId: string): Promise<Pick<Shipment, 'status' | 'updatedAt'> | null>;
}

const firestoreSource: BackfillOrderSource = {
  async listPaidOrders(afterId, limit) {
    let query = firestore
      .collection('orders')
      .where('paymentStatus', '==', 'succeeded')
      .orderBy(FieldPath.documentId(), 'asc');
    if (afterId) {
      query = query.startAfter(afterId);
    }
    const snapshot = await query.limit(limit).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  },
  getShipment: (orderId) =>
    new ShipmentRepository().getShipmentByOrderId(orderId),
};

export class PayoutBackfillService {
  constructor(private readonly source: BackfillOrderSource = firestoreSource) {}

  // Dry run unless `apply` is set. Safe to repeat: an order that already has a
  // payoutStatus is skipped, both in the plan and inside the write transaction.
  async run(options: {
    apply: boolean;
    limit?: number;
    now?: Date;
    pageSize?: number;
    onPlan?: (orderId: string, plan: BackfillPlan) => void;
  }): Promise<BackfillSummary> {
    const now = options.now ?? new Date();
    const pageSize = options.pageSize ?? 200;
    const summary: BackfillSummary = {
      scanned: 0,
      held: 0,
      disputed: 0,
      skipped: { already_migrated: 0, not_paid: 0, not_delivered: 0 },
      errors: 0,
    };
    let afterId: string | undefined;

    for (;;) {
      const page = await this.source.listPaidOrders(afterId, pageSize);
      if (page.length === 0) {
        return summary;
      }

      for (const { id, data } of page) {
        if (options.limit !== undefined && summary.scanned >= options.limit) {
          return summary;
        }
        summary.scanned += 1;

        try {
          const shipment = isDelivered(data) && !data.payoutStatus
            ? await this.source.getShipment(id)
            : null;
          const plan = planBackfill(data, shipment, now);
          options.onPlan?.(id, plan);

          if (plan.action === 'skip') {
            summary.skipped[plan.reason] += 1;
            continue;
          }
          if (options.apply && !(await this.apply(id, plan, now))) {
            summary.skipped.already_migrated += 1;
            continue;
          }
          summary.held += 1;
          if (plan.holdReason) {
            summary.disputed += 1;
          }
        } catch (err) {
          summary.errors += 1;
          console.error(`Backfill failed for order ${id}:`, err);
        }
      }
      afterId = page[page.length - 1].id;
    }
  }

  private async apply(
    orderId: string,
    plan: Extract<BackfillPlan, { action: 'hold' }>,
    now: Date,
  ): Promise<boolean> {
    const orderRef = firestore.collection('orders').doc(orderId);

    return firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists || orderDoc.data()!.payoutStatus) {
        return false;
      }

      transaction.update(orderRef, {
        payoutStatus: 'held',
        deliveredAt: orderDoc.data()!.deliveredAt ?? plan.deliveredAt,
        releaseAt: plan.releaseAt,
        ...(plan.autoRelease ? { autoReleaseAt: plan.releaseAt } : {}),
        ...(plan.holdReason ? holdReasonFields([plan.holdReason]) : {}),
        updatedAt: now,
      });
      recordPayoutEvent(
        transaction,
        orderRef,
        {
          type: 'hold_started',
          actorRole: 'system',
          fromStatus: null,
          toStatus: 'held',
          releaseAt: plan.releaseAt,
          reason: plan.holdReason,
          note: `Backfilled for an order delivered before payout holds existed; delivery time taken from ${plan.deliveredAtSource}`,
        },
        now,
      );
      return true;
    });
  }
}
