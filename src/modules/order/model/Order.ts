export type DeliveryType = 'home' | 'pickup_point';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
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
