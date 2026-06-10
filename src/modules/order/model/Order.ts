export type DeliveryType = 'home' | 'pickup_point';
// BACKWARDS COMPATIBILITY NOTE (added 2026-05-21):
// 'processing' was added to PaymentStatus alongside the Stripe webhook hardening.
// Existing Firestore order documents written before this change will only contain
// 'pending' | 'succeeded' | 'failed'. The fallback in OrderRepository.getOrdersByDateRange
// (currently `data.paymentStatus || 'pending'`) safely handles any legacy document
// that predates this change.
//
// TODO (future engineer): Once you are confident no documents with unrecognised
// paymentStatus values exist in Firestore (e.g. after a data migration or sufficient
// run-time), you may narrow this type back and remove the || 'pending' fallback.
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type ShipmentStatus =
  | 'not_created'
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
  distanceMeters?: number | null;
  latitude?: string | null;
  longitude?: string | null;
  openTomorrow?: boolean;
  openUpcomingWeek?: boolean;
}

export interface Order {
  id: string;
  userId: string;
  email?: string;
  amount: number;
  productId?: string;
  productName?: string;
  deliveryType: DeliveryType;
  shippingOptionId: string;
  shippingOptionName?: string;
  shippingOptionPrice?: string;
  shippingCarrier?: string;
  shippingWeight: number;
  shipping: {
    address: ShippingAddress;
    name: string;
    telephone?: string;
  };
  pickupPoint?: PickupPointSelection;
  pickupPointId?: string;
  pickupPointName?: string;
  pickupPointAddressLine1?: string;
  pickupPointCity?: string;
  pickupPointPostalCode?: string;
  pickupPointCountry?: string;
  pickupPointCarrier?: string | null;
  paymentIntentId?: string;
  paymentStatus: PaymentStatus;
  status?: 'completed' | 'pending' | 'failed';
  shipmentStatus: ShipmentStatus;
  shipmentId?: string;
  createdAt: Date;
}
