import { PayoutHoldReason, PayoutReleaseTrigger } from '../model/Order';

export type PayoutEventType =
  | 'hold_started'
  | 'hold_placed'
  | 'hold_cleared'
  | 'released';

export type PayoutEventActorRole =
  | 'system'
  | 'buyer'
  | 'admin'
  | 'stripe';

// Append-only history in orders/{orderId}/payout_events, written in the same
// transaction as the state change it describes so the two can never diverge.
export interface PayoutEvent {
  eventId: string;
  type: PayoutEventType;
  actorRole: PayoutEventActorRole;
  actorId?: string;
  fromStatus: string | null;
  toStatus: string;
  trigger?: PayoutReleaseTrigger;
  reason?: PayoutHoldReason;
  note?: string;
  stripeEventId?: string;
  releaseAt?: Date;
  createdAt: Date;
}

export type NewPayoutEvent = Omit<PayoutEvent, 'eventId' | 'createdAt'>;

const removeUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;

export const recordPayoutEvent = (
  transaction: FirebaseFirestore.Transaction,
  orderRef: FirebaseFirestore.DocumentReference,
  event: NewPayoutEvent,
  now: Date,
): void => {
  transaction.create(
    orderRef.collection('payout_events').doc(),
    removeUndefined({ ...event, createdAt: now }),
  );
};
