export interface Shipment {
  id: string;
  orderId: string;
  sendcloudId?: number;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  status: 'pending' | 'announced' | 'en_route' | 'out_for_delivery' | 'delivered' | 'exception' | 'cancelled';
  labelUrl?: string;
  parcel: {
    name: string;
    address: string;
    address_2?: string;
    city: string;
    postal_code: string;
    country: string;
    email?: string;
    telephone?: string;
    weight: number; // in grams
    order_number: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface SendcloudParcel {
  id: number;
  tracking_number?: string;
  tracking_url?: string;
  status?: {
    id: number;
    message: string;
  };
  carrier?: {
    name: string;
  };
  label?: {
    label_printer: string;
  };
}

export interface SendcloudShippingMethod {
  id: number;
  name: string;
  carrier: string;
  min_weight: number;
  max_weight: number;
  countries: string[];
  price: number;
}