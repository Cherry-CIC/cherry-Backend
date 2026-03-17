import {
  SendcloudParcel,
  SendcloudPickupPoint,
  SendcloudShippingMethod,
} from '../models/Shipment';

export interface ShippingMethodsOptions {
  servicePointId?: string;
}

export interface ShippingParcelRequest {
  name: string;
  address: string;
  address_2?: string;
  city: string;
  postal_code: string;
  country: string;
  email?: string;
  telephone?: string;
  weight: number;
  order_number: string;
  shipment?: {
    id: number;
  };
  to_service_point?: string;
}

export interface ShippingProvider {
  createParcel(parcelData: ShippingParcelRequest): Promise<SendcloudParcel>;
  createParcelToServicePoint(
    parcelData: ShippingParcelRequest,
    servicePointId: string,
    shippingMethodId: number,
  ): Promise<SendcloudParcel>;
  getParcel(parcelId: number): Promise<SendcloudParcel>;
  getShippingMethods(
    options?: ShippingMethodsOptions,
  ): Promise<SendcloudShippingMethod[]>;
  cancelParcel(parcelId: number): Promise<unknown>;
  getLabelUrl(parcelId: number): Promise<string>;
  getPickupPoints(
    postcode: string,
    courier?: string,
  ): Promise<SendcloudPickupPoint[]>;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean;
}
