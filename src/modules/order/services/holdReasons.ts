import { FieldValue } from 'firebase-admin/firestore';
import { PayoutHoldReason } from '../model/Order';

const HOLD_REASONS: readonly string[] = [
  'dispute',
  'refund',
  'chargeback',
  'fraud',
  'admin',
];

const isHoldReason = (value: unknown): value is PayoutHoldReason =>
  typeof value === 'string' && HOLD_REASONS.includes(value);

// payoutHoldReasons is the source of truth. Orders written before it existed
// only carry the single payoutHoldReason, which is read as a one-item set.
export const getActiveHoldReasons = (
  order: FirebaseFirestore.DocumentData,
): PayoutHoldReason[] => {
  if (Array.isArray(order.payoutHoldReasons)) {
    return [...new Set(order.payoutHoldReasons.filter(isHoldReason))];
  }
  return isHoldReason(order.payoutHoldReason) ? [order.payoutHoldReason] : [];
};

// payoutHoldReason mirrors the first active reason for display and export.
export const holdReasonFields = (reasons: PayoutHoldReason[]) =>
  reasons.length > 0
    ? { payoutHoldReasons: reasons, payoutHoldReason: reasons[0] }
    : {
        payoutHoldReasons: FieldValue.delete(),
        payoutHoldReason: FieldValue.delete(),
      };

export const addHoldReason = (
  reasons: PayoutHoldReason[],
  reason: PayoutHoldReason,
): PayoutHoldReason[] =>
  reasons.includes(reason) ? reasons : [...reasons, reason];

export const removeHoldReason = (
  reasons: PayoutHoldReason[],
  reason: PayoutHoldReason,
): PayoutHoldReason[] => reasons.filter((existing) => existing !== reason);
