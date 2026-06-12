export type DeliveryType = 'home' | 'pickup_point';
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
  email: string;
  productAmount: number;
  shippingFee: number;
  securityFee: number;
  totalAmount: number;
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
  paymentIntentId: string;
  paymentStatus: 'succeeded';
  status:
    | 'paid'
    | 'shipment_pending'
    | 'shipment_created'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'failed';
  shipmentStatus: ShipmentStatus;
  shipmentId?: string;
  createdAt: Date;
}
