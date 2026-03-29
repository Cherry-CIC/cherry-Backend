import axios from 'axios';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { SendcloudParcel, SendcloudShippingMethod } from '../models/Shipment';
import {
  CheckoutShippingOptionsQuery,
  PickupPointsQuery,
} from './CheckoutShippingService';

export class SendcloudService {
  private client: any;
  private dynamicCheckoutClient: any;
  private servicePointsClient: any;

  constructor() {
    const {
      publicKey,
      secretKey,
      apiUrl,
      dynamicCheckoutApiUrl,
      servicePointsApiUrl,
    } = sendcloudConfig;

    if (!publicKey || !secretKey) {
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

    this.dynamicCheckoutClient = axios.create({
      baseURL: dynamicCheckoutApiUrl,
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
    const { checkoutConfigurationId, senderCountry } = sendcloudConfig;

    if (!checkoutConfigurationId) {
      throw new Error(
        'Sendcloud checkout configuration is missing. Please set SENDCLOUD_CHECKOUT_CONFIGURATION_ID.',
      );
    }

    if (!senderCountry) {
      throw new Error(
        'Sendcloud sender country is missing. Please set SENDCLOUD_SENDER_COUNTRY.',
      );
    }

    try {
      const response = await this.dynamicCheckoutClient.get(
        `/checkout/configurations/${checkoutConfigurationId}/delivery-options`,
        {
          params: {
            weight_value: query.weight,
            total_order_value: query.value,
            from_country_code: senderCountry,
            to_country_code: query.country,
            to_postal_code: query.postalCode,
            checkout_identifier_type: 'shipping_option_code',
          },
        },
      );

      return response.data?.delivery_options || [];
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
    try {
      const response = await this.servicePointsClient.get('/service-points', {
        params: {
          access_token: sendcloudConfig.publicKey,
          country: query.country,
          postal_code: query.postalCode,
          city: query.city,
          address: query.address,
          house_number: query.houseNumber,
          weight: query.weight,
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
