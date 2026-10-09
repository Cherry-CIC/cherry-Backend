import { OrderDisputeReason } from '../modules/order/model/Order';

export type DisputeStatus =
  | 'under_review'
  | 'awaiting_seller'
  | 'awaiting_buyer'
  | 'resolved_refunded'
  | 'resolved_rejected'
  | 'closed';

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