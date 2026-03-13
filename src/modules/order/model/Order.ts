export interface Order {
  id: string;
  userId: string; // ID of the user who placed the order
  email?: string; // Email of the user (stored for reporting purposes)
  amount: number; // amount in the smallest currency unit (e.g., pence)
  productId?: string;
  productName?: string;
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
  /**
   * How this order should be delivered.
   * - "ship_to_home"  → Sendcloud creates a parcel and ships to the provided address.
   * - "pickup_point"  → Customer collects from a Sendcloud service point; parcel creation
   *                     is deferred until the pickup-point ID and courier are confirmed.
   */
  deliveryMethod?: 'ship_to_home' | 'pickup_point';
  /** Shipping provider – "sendcloud" for now; structured so a future provider can be added. */
  shippingProvider?: 'sendcloud';
  /** Courier slug used for pickup-point orders (e.g. "dhl", "ups"). */
  courier?: string;
  /** Sendcloud service-point ID chosen by the customer (pickup_point orders only). */
  pickupPointId?: string;
  /** Populated once the Sendcloud parcel is created. */
  trackingNumber?: string;
  status?: 'completed' | 'pending' | 'failed'; // Order status for tracking
  shipmentId?: string; // Reference to shipment document
  createdAt: Date;
}
