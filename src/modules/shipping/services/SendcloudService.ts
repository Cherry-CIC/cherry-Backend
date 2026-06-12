import axios from 'axios';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { SendcloudParcel, SendcloudShippingMethod } from '../models/Shipment';
import {
  CheckoutShippingOptionsQuery,
  PickupPointsQuery,
} from './CheckoutShippingService';

export class SendcloudService {
  private client: any;
  private servicePointsClient: any;

  constructor() {
    const {
      publicKey,
      secretKey,
      apiUrl,
      servicePointsApiUrl,
    } = sendcloudConfig;

    if (
      sendcloudConfig.mode !== 'mock' &&
      (!publicKey || !secretKey)
    ) {
      throw new Error(
        'Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.',
      );
    }

    this.client = axios.create({
      baseURL: apiUrl,
      auth: {
        username: publicKey,
        password: secretKey,
      },
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.servicePointsClient = axios.create({
      baseURL: servicePointsApiUrl,
      auth: {
        username: publicKey,
        password: secretKey,
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 30000,
    });
  }

  async createParcel(parcelData: any): Promise<SendcloudParcel> {
    if (sendcloudConfig.mode === 'mock') {
      return {
        id: Date.now(),
        tracking_number: `MOCK-${parcelData.order_number}`,
        tracking_url: `https://example.test/tracking/${parcelData.order_number}`,
        status: { id: 1, message: 'Announced' },
        carrier: { name: sendcloudConfig.enforcedCarrier },
      };
    }

    try {
      const response = await this.client.post('/parcels', {
        parcel: parcelData,
      });
      return response.data.parcel;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getParcel(parcelId: number): Promise<SendcloudParcel> {
    if (sendcloudConfig.mode === 'mock') {
      return {
        id: parcelId,
        tracking_number: `MOCK-${parcelId}`,
        tracking_url: `https://example.test/tracking/${parcelId}`,
        status: { id: 1, message: 'Announced' },
        carrier: { name: sendcloudConfig.enforcedCarrier },
      };
    }

    try {
      const response = await this.client.get(`/parcels/${parcelId}`);
      return response.data.parcel;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getShippingMethods(): Promise<SendcloudShippingMethod[]> {
    try {
      const response = await this.client.get('/shipping_methods');
      return response.data.shipping_methods || [];
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getCheckoutDeliveryOptions(
    query: CheckoutShippingOptionsQuery,
  ): Promise<any[]> {
    if (sendcloudConfig.mode === 'mock') {
      return [
        {
          id: 3747,
          name: 'Mock InPost locker delivery',
          carrier: sendcloudConfig.enforcedCarrier,
          service_point_input: 'required',
          min_weight: 0,
          max_weight: 15,
          price: { amount: '3.99', currency: 'GBP' },
        },
      ];
    }

    try {
      const response = await this.client.get(
        '/shipping_methods',
        {
          params: {
            service_point_id: query.servicePointId,
            to_country: query.country,
            to_postal_code: query.postalCode,
            is_return: query.isReturn,
          },
        },
      );

      const methods = response.data?.shipping_methods || [];
      if (!query.carrier) {
        return methods;
      }

      const targetCarrier = query.carrier.toLowerCase();
      return methods.filter(
        (method: any) => {
          const carrier =
            method?.carrier?.code ??
            method?.carrier?.name ??
            method?.carrier ??
            method?.carrier_code ??
            '';
          return String(carrier).toLowerCase() === targetCarrier;
        },
      );
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.response?.data?.detail ||
        JSON.stringify(error.response?.data) ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getServicePoints(query: PickupPointsQuery): Promise<any[]> {
    if (sendcloudConfig.mode === 'mock') {
      return [
        {
          id: 13127548,
          name: 'Mock InPost Locker',
          street: '123 High Street',
          house_number: '',
          city: 'London',
          postal_code: query.address,
          country: query.country,
          carrier: sendcloudConfig.enforcedCarrier,
          distance: 250,
          latitude: '51.5074',
          longitude: '-0.1278',
          open_tomorrow: true,
          open_upcoming_week: true,
        },
      ];
    }

    try {
      const response = await this.servicePointsClient.get('/service-points', {
        params: {
          access_token: sendcloudConfig.publicKey,
          country: query.country,
          address: query.address,
          radius: query.radius ?? 5000,
          carrier: query.carrier,
        },
      });

      return response.data || [];
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getPickupPoints(postcode: string, courier?: string): Promise<any[]> {
    try {
      const params: Record<string, string> = {
        country: 'GB',
        postcode,
      };

      if (courier) {
        params.carrier = courier;
      }

      const response = await this.servicePointsClient.get('/service-points', {
        params,
      });

      return response.data || [];
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error (pickup points): ${errorMessage}`);
    }
  }

  async cancelParcel(parcelId: number): Promise<any> {
    try {
      const response = await this.client.post(`/parcels/${parcelId}/cancel`);
      return response.data;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getLabelUrl(parcelId: number): Promise<string> {
    try {
      const response = await this.client.get(`/labels/${parcelId}`);
      return (
        response.data.label?.label_printer ||
        response.data.label?.normal_printer?.[0] ||
        ''
      );
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async getTrackingInfo(trackingNumber: string): Promise<any> {
    try {
      const response = await this.client.get('/parcels', {
        params: {
          tracking_number: trackingNumber,
        },
      });
      return response.data.parcels?.[0] || null;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  async updateParcel(
    parcelId: number,
    updates: any,
  ): Promise<SendcloudParcel> {
    try {
      const response = await this.client.put(`/parcels/${parcelId}`, {
        parcel: updates,
      });
      return response.data.parcel;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }
}
