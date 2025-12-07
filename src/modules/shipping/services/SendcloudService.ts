import axios from 'axios';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { SendcloudParcel, SendcloudShippingMethod } from '../models/Shipment';

/**
 * Service for interacting with the Sendcloud API
 * Handles parcel creation, tracking, label generation, and shipping methods
 */
export class SendcloudService {
  private client: any;

  constructor() {
    const { publicKey, secretKey, apiUrl } = sendcloudConfig;

    if (!publicKey || !secretKey) {
      throw new Error(
        'Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.'
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
  async createParcel(parcelData: any): Promise<SendcloudParcel> {
    try {
      const response = await this.client.post('/parcels', {
        parcel: parcelData,
      });
      return response.data.parcel;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
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
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }

  /**
   * Get all available shipping methods
   * @returns List of shipping methods
   */
  async getShippingMethods(): Promise<SendcloudShippingMethod[]> {
    try {
      const response = await this.client.get('/shipping_methods');
      return response.data.shipping_methods || [];
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
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
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
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
      return response.data.label?.label_printer || response.data.label?.normal_printer?.[0] || '';
    } catch (error: any) {
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
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
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
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
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      throw new Error(`Sendcloud API Error: ${errorMessage}`);
    }
  }
}