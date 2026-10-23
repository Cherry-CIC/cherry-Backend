import { PayoutReleaseTrigger } from '../model/Order';
import { getActiveHoldReasons } from './holdReasons';

export type PayoutReleaseBlockReason =
  | 'order_not_found'
  | 'not_held'
  | 'not_due'
  | 'not_delivered'
  | 'payment_not_confirmed'
  | 'payment_flagged'
  | 'dispute_open'
  | 'on_hold';

export type PayoutReleaseResult =
  | { status: 'released' }
  | { status: 'already_released' }
  | { status: 'blocked'; reason: PayoutReleaseBlockReason };

export const toDateOrNull = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Shared by the buyer-confirmation, expiry and dispute-resolution paths so all
// three apply the same rules inside their own Firestore transactions.
export const evaluatePayoutRelease = (input: {
  order: FirebaseFirestore.DocumentData;
  payment: FirebaseFirestore.DocumentData | null;
  trigger: PayoutReleaseTrigger;
  now: Date;
}): { canRelease: true } | { canRelease: false; result: PayoutReleaseResult } => {
  const { order, payment, trigger, now } = input;
  const blocked = (reason: PayoutReleaseBlockReason) => ({
    canRelease: false as const,
    result: { status: 'blocked' as const, reason },
  });

  if (order.payoutStatus === 'ready_for_payout') {
    return {
      canRelease: false,
      result: { status: 'already_released' },
    };
  }
  if (order.payoutStatus !== 'held') {
    return blocked('not_held');
  }
  if (
    order.paymentStatus !== 'succeeded' ||
    ['cancelled', 'failed', 'expired'].includes(order.status)
  ) {
    return blocked('payment_not_confirmed');
  }
  if (payment?.status === 'flagged') {
    return blocked('payment_flagged');
  }
  if (!order.deliveredAt) {
    return blocked('not_delivered');
  }

  // Resolving a buyer dispute in favour of release lifts only the dispute hold.
  // Refund, chargeback, fraud and admin holds stay in force; an explicit admin
  // override lifts them, but never an unresolved buyer dispute, which has its
  // own resolution flow.
  if (trigger !== 'admin_override') {
    const blockingHolds = getActiveHoldReasons(order).filter(
      (reason) => !(trigger === 'dispute_resolution' && reason === 'dispute'),
    );
    if (blockingHolds.length > 0) {
      return blocked('on_hold');
    }
  }
  if (trigger !== 'dispute_resolution') {
    if (order.buyerDisputeId && order.buyerDisputeStatus !== 'resolved') {
      return blocked('dispute_open');
    }
  }

  if (trigger === 'hold_expired') {
    const releaseAt = toDateOrNull(order.releaseAt);
    if (!releaseAt || releaseAt.getTime() > now.getTime()) {
      return blocked('not_due');
    }
  }

  return { canRelease: true };
};
