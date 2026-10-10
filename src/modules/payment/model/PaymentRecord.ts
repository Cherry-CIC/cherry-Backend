// Stored in payments/{paymentIntentId} by the Stripe webhook. Amounts in pence.
// 'flagged' = Stripe took the money but our checks failed; needs manual review.
export type PaymentRecordStatus = 'paid' | 'flagged';

export interface PaymentRecord {
  paymentIntentId: string;
  status: PaymentRecordStatus;
  flagReason: string | null;
  firebaseUid: string | null;
  productId: string | null;
  amount: number;
  currency: string;
  productAmount: number | null;
  shippingFee: number | null;
  securityFee: number | null;
  stripeChargeId: string | null;
  stripeBalanceTransactionId: string | null;
  paidAt: Date;
  orderId: string | null;
  lastStripeEventId: string;
  firstReceivedAt: Date;
  updatedAt: Date;
}

export type PaymentRecordInput = Omit<
  PaymentRecord,
  'orderId' | 'firstReceivedAt' | 'updatedAt'
>;
