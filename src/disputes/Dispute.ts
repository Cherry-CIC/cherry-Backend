import { OrderDisputeReason } from '../modules/order/model/Order';

export type DisputeStatus =
  | 'raised'
  | 'in_progress'
  | 'resolved';

export const DISPUTE_STATUSES: DisputeStatus[] = [
  'raised',
  'in_progress',
  'resolved',
];

export type AdminModerationStatus = Extract<
  DisputeStatus,
  'in_progress' | 'resolved'
>;

// What happens to the held funds when an admin resolves a dispute.
export type DisputeResolutionOutcome = 'release_to_charity' | 'refund_buyer';
export const DISPUTE_RESOLUTION_OUTCOMES: DisputeResolutionOutcome[] = [
  'release_to_charity',
  'refund_buyer',
];

export interface Dispute {
  disputeId: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  productId: string;
  productName: string;
  reason: OrderDisputeReason;
  message?: string;
  status: DisputeStatus;
  assignedAdminId?: string;
  claimedAt?: Date;
  resolution?: {
    note: string;
    outcome?: DisputeResolutionOutcome;
    resolvedBy: string;
    resolvedAt: Date;
  };
  orderSnapshot: {
    totalAmount: number;
    currency: string;
    paymentIntentId: string;
    orderStatus: string;
    shipmentStatus: string;
  };
  evidence: { storagePath: string; uploadedBy: string; uploadedAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export type DisputeSubmissionErrorCode =
  | 'order_not_found'
  | 'not_order_owner'
  | 'order_not_eligible'
  | 'dispute_window_closed';

export class DisputeSubmissionError extends Error {
  constructor(readonly code: DisputeSubmissionErrorCode) {
    super(code);
    this.name = 'DisputeSubmissionError';
  }
}

export interface DisputeEvent {
  eventId: string;
  type: string;
  actorId: string;
  actorRole: 'buyer' | 'seller' | 'admin';
  fromStatus: DisputeStatus | null;
  toStatus: DisputeStatus;
  note?: string;
  createdAt: Date;
}

export type DisputeAdminErrorCode =
  | 'dispute_not_found'
  | 'idempotency_key_reused'
  | 'invalid_status_transition'
  | 'release_blocked'
  | 'cursor_not_found';

export class DisputeAdminError extends Error {
  constructor(readonly code: DisputeAdminErrorCode) {
    super(code);
    this.name = 'DisputeAdminError';
  }
}
