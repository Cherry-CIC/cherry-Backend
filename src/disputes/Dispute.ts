import { OrderDisputeReason } from '../modules/order/model/Order';

export type DisputeStatus =
  | 'under_review'
  | 'awaiting_seller'
  | 'awaiting_buyer'
  | 'resolved_refunded'
  | 'resolved_rejected'
  | 'closed';

export const DISPUTE_STATUSES: DisputeStatus[] = [
  'under_review',
  'awaiting_seller',
  'awaiting_buyer',
  'resolved_refunded',
  'resolved_rejected',
  'closed',
];

export type AdminModerationStatus = Exclude<
  DisputeStatus,
  'resolved_refunded'
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
  resolution?: {
    outcome: 'rejected';
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
  | 'invalid_status_transition'
  | 'cursor_not_found';

export class DisputeAdminError extends Error {
  constructor(readonly code: DisputeAdminErrorCode) {
    super(code);
    this.name = 'DisputeAdminError';
  }
}