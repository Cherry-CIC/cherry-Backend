import axios from 'axios';
import crypto from 'crypto';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import {
  SendcloudParcel,
  SendcloudPickupPoint,
  SendcloudShippingMethod,
} from '../models/Shipment';
import {
  ShippingMethodsOptions,
  ShippingParcelRequest,
  ShippingProvider,
} from './ShippingProvider';

/**
 * Service for interacting with the Sendcloud API
 * Handles parcel creation, tracking, label generation, shipping methods,
 * and pickup-point (service-point) lookups.
 */
const normaliseBuffer = (rawBody: Buffer | string): Buffer =>
  Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

const normaliseSignature = (signature: string): string =>
  signature.replace(/^sha256=/i, '').trim();

const timingSafeCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export class SendcloudService implements ShippingProvider {
  private readonly client: any;

  constructor() {
    const { publicKey, secretKey, apiUrl } = sendcloudConfig;

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
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Create a parcel (shipment) in Sendcloud
   * @param parcelData - Parcel information including address, weight, etc.
   * @returns Created parcel from Sendcloud
   */
  async createParcel(
    parcelData: ShippingParcelRequest,
  ): Promise<SendcloudParcel> {
    try {
      const response = await this.client.post('/parcels', {
        parcel: {
          ...parcelData,
          request_label: true,
        },
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

  async createParcelToServicePoint(
    parcelData: ShippingParcelRequest,
    servicePointId: string,
    shippingMethodId: number,
  ): Promise<SendcloudParcel> {
    try {
      const response = await this.client.post('/parcels', {
        parcel: {
          ...parcelData,
          request_label: true,
          shipment: { id: shippingMethodId },
          to_service_point: servicePointId,
        },
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

  /**
   * Get parcel details by Sendcloud parcel ID
   * @param parcelId - Sendcloud parcel ID
   * @returns Parcel details
   */
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

  /**
   * Get all available shipping methods
   * @returns List of shipping methods
   */
  async getShippingMethods(
    options?: ShippingMethodsOptions,
  ): Promise<SendcloudShippingMethod[]> {
    try {
      const params: Record<string, string> = {};

      if (options?.servicePointId) {
        params.service_point_id = options.servicePointId;
      }

      const response = await this.client.get('/shipping_methods', { params });
      return response.data.shipping_methods || [];
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  /**
   * Cancel a parcel
   * @param parcelId - Sendcloud parcel ID
   * @returns Response from Sendcloud
   */
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

  /**
   * Get label PDF URL for a parcel
   * @param parcelId - Sendcloud parcel ID
   * @returns Label PDF URL
   */
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

  /**
   * Get tracking information for a parcel
   * @param trackingNumber - Tracking number
   * @returns Tracking information
   */
  async getTrackingInfo(trackingNumber: string): Promise<any> {
    try {
      const response = await this.client.get(`/parcels`, {
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

  /**
   * Update parcel information
   * @param parcelId - Sendcloud parcel ID
   * @param updates - Fields to update
   * @returns Updated parcel
   */
  async updateParcel(parcelId: number, updates: any): Promise<SendcloudParcel> {
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

  /**
   * Fetch Sendcloud service points (pickup locations) near a given postcode.
   *
   * Used by GET /api/shipping/pickup-points to populate the in-app pickup-point picker.
   *
   * @param postcode - Postal code to search around (e.g. "SW1A1AA").
   * @param courier  - Optional carrier slug to filter results (e.g. "dhl", "ups").
   *                   When omitted, all carriers are returned.
   * @returns Array of {@link SendcloudPickupPoint} objects.
   */
  async getPickupPoints(
    postcode: string,
    courier?: string,
  ): Promise<SendcloudPickupPoint[]> {
    try {
      const params: Record<string, string> = {
        country: 'GB',
        postcode,
      };
      if (courier) {
        params.carrier = courier;
      }

      const response = await this.client.get('/service-points', { params });
      return (response.data as SendcloudPickupPoint[]) || [];
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Sendcloud API Error (pickup points): ${errorMessage}`);
    }
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const secret = sendcloudConfig.webhookSecret;

    if (!secret || !signature) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(normaliseBuffer(rawBody))
      .digest('hex');

    return timingSafeCompare(expectedSignature, normaliseSignature(signature));
  }
}
