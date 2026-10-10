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
  | 'order_not_eligible';

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
  | 'cursor_not_found';

export class DisputeAdminError extends Error {
  constructor(readonly code: DisputeAdminErrorCode) {
    super(code);
    this.name = 'DisputeAdminError';
  }
}
