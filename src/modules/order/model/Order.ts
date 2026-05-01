export interface Order {
  id: string;
  userId: string; // ID of the user who placed the order
  email?: string; // Email of the user (stored for reporting purposes)
  amount: number; // amount in the smallest currency unit (e.g., pence)
  currency?: 'gbp';
  paymentIntentId?: string;
  paymentStatus?: string;
  productId?: string;
  productName?: string;
  productSnapshot?: {
    id?: string;
    name?: string;
    charityId?: string;
    price?: number;
    donation?: number;
  };
  shipping?: {
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
    name?: string;
  };
  deliveryType?: 'home' | 'pickup_point';
  /**
   * How this order should be delivered.
   * - "ship_to_home"  → Sendcloud creates a parcel and ships to the provided address.
   * - "pickup_point"  → Customer collects from a Sendcloud service point; parcel creation
   *                     is deferred until the pickup-point ID and courier are confirmed.
   */
  deliveryMethod?: 'ship_to_home' | 'pickup_point';
  /** Shipping provider – "sendcloud" for now; structured so a future provider can be added. */
  shippingProvider?: 'sendcloud';
  shippingOptionId?: string;
  shippingOptionName?: string;
  shippingOptionPrice?: number;
  shippingCarrier?: string;
  shippingWeight?: number;
  /** Courier slug used for pickup-point orders (e.g. "dhl", "ups"). */
  courier?: string;
  /** Sendcloud service-point ID chosen by the customer (pickup_point orders only). */
  pickupPointId?: string;
  pickupPoint?: {
    id: string;
    name?: string;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    carrier?: string;
  };
  /** Populated once the Sendcloud parcel is created. */
  trackingNumber?: string;
  status?: 'completed' | 'pending' | 'failed'; // Order status for tracking
  shipmentStatus?: 'pending' | 'announced' | 'failed';
  shipmentId?: string; // Reference to shipment document
  createdAt: Date;
}
