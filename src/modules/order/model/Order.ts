export type DeliveryType = 'home' | 'pickup_point';
export type OrderDisputeReason =
  | 'wrong_item'
  | 'item_not_as_described'
  | 'item_arrived_damaged'
  | 'something_else';
export type OrderDisputeStatus =
  | 'raised'
  | 'in_progress'
  | 'resolved';
// Funds lifecycle, separate from the fulfilment `status`. Later payout states
// (payout_processing, paid_to_charity, payout_failed) belong to the payout issue.
export type PayoutStatus = 'held' | 'ready_for_payout';
export type PayoutHoldReason = 'dispute' | 'refund' | 'chargeback' | 'fraud' | 'admin';
export type PayoutReleaseTrigger =
  | 'buyer_confirmation'
  | 'hold_expired'
  | 'dispute_resolution'
  | 'admin_override';
export type ShipmentStatus =
  | 'pending'
  | 'announced'
  | 'en_route'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'cancelled';

export interface ShippingAddress {
  line1: string;
  line2?: string;
  house_number?: string;
  city: string;
  state?: string;
  postal_code: string;
  country: string;
}

export interface PickupPointSelection {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
  carrier?: string | null;
}

export interface Order {
  id: string;
  userId: string;
  sellerId: string;
  charityId: string;
  email: string;
  productAmount: number;
  shippingFee: number;
  securityFee: number;
  totalAmount: number;
  // Financial breakdown in pence. Absent on orders created before it was
  // recorded; stripeFee and cherryRevenue are null until Stripe reports its fee.
  charityProceeds?: number;
  stripeFee?: number | null;
  cherryRevenue?: number | null;
  currency: 'GBP';
  productId: string;
  productName: string;
  deliveryType: DeliveryType;
  shippingOptionId: string;
  shippingOptionName: string;
  shippingCarrier: string;
  shippingWeight: number;
  shipping: {
    address: ShippingAddress;
    name: string;
    telephone: string;
  };
  pickupPoint: PickupPointSelection;
  paymentIntentId?: string;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
  status:
    | 'pending_payment'
    | 'expired'
    | 'paid'
    | 'shipment_pending'
    | 'shipment_created'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'failed';
  shipmentStatus: ShipmentStatus;
  shipmentId?: string;
  paymentExpiresAt?: Date;
  reservationActive?: boolean;
  paidAt?: Date;
  refundedAt?: Date;
  // Set once, when the carrier first reports delivery. The dispute window and
  // payout hold both run from this moment.
  deliveredAt?: Date;
  payoutStatus?: PayoutStatus;
  // Every hold currently blocking the payout; it is released only once empty.
  payoutHoldReasons?: PayoutHoldReason[];
  // The first active reason, kept for display and export.
  payoutHoldReason?: PayoutHoldReason;
  releaseAt?: Date;
  // releaseAt while the order may be released automatically; absent while any
  // hold or dispute blocks it, so reconciliation only scans releasable orders.
  autoReleaseAt?: Date;
  releaseTaskEnqueuedAt?: Date;
  readyForPayoutAt?: Date;
  payoutReleaseTrigger?: PayoutReleaseTrigger;
  updatedAt?: Date;
  buyerConfirmedReceived?: boolean;
  buyerConfirmedReceivedAt?: Date;
  sellerSoldEmailSentAt?: Date;
  buyerShipmentStartedEmailSentAt?: Date;
  buyerDeliveryEmailSentAt?: Date;
  buyerDisputeId?: string;
  buyerDisputeReason?: OrderDisputeReason;
  buyerDisputeStatus?: OrderDisputeStatus;
  buyerDisputeMessage?: string;
  buyerDisputedAt?: Date;
  createdAt: Date;
}
