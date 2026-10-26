export type FulfillmentJobStatus = 'pending' | 'processing' | 'completed';
export type SellerEmailStatus = 'pending' | 'sent' | 'skipped' | 'failed';
export type LabelAttachmentStatus =
  | 'pending'
  | 'attached'
  | 'failed'
  | 'not_available';

export interface FulfillmentJob {
  orderId: string;
  status: FulfillmentJobStatus;
  attempts: number;
  leaseUntil?: Date;
  shipmentCompleted: boolean;
  sellerNotificationCompleted: boolean;
  buyerNotificationCompleted: boolean;
  sellerEmailStatus?: SellerEmailStatus;
  labelAttachmentStatus?: LabelAttachmentStatus;
  labelAttachmentError?: string | null;
  lastSellerEmailAttemptAt?: Date;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
