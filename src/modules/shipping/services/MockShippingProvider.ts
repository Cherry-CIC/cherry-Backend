import crypto from 'crypto';
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
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

const MOCK_SHIPPING_METHODS: SendcloudShippingMethod[] = [
  {
    id: 101,
    name: 'Mock Standard Home',
    carrier: 'mock-home',
    min_weight: 1,
    max_weight: 30000,
    countries: ['GB'],
    price: 0,
  },
  {
    id: 102,
    name: 'Mock Express Home',
    carrier: 'mock-home',
    min_weight: 1,
    max_weight: 30000,
    countries: ['GB'],
    price: 0,
  },
  {
    id: 201,
    name: 'Mock Pickup Standard',
    carrier: 'mock-pickup',
    min_weight: 1,
    max_weight: 30000,
    countries: ['GB'],
    price: 0,
  },
];

const normaliseBuffer = (rawBody: Buffer | string): Buffer =>
  Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

const createSignature = (rawBody: Buffer | string, secret: string): string =>
  crypto
    .createHmac('sha256', secret)
    .update(normaliseBuffer(rawBody))
    .digest('hex');

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

const createMockParcel = (
  parcelId: number,
  carrier: string,
): SendcloudParcel => ({
  id: parcelId,
  tracking_number: `MOCK-TRACK-${parcelId}`,
  tracking_url: `https://tracking.mock.sendcloud.dev/parcels/${parcelId}`,
  status: {
    id: 1,
    message: 'Announced',
  },
  carrier: {
    name: carrier,
  },
  label: {
    label_printer: `https://labels.mock.sendcloud.dev/${parcelId}.pdf`,
  },
});

const buildMockParcelId = (seed: string): number => {
  let total = 0;

  for (const character of seed) {
    total += character.charCodeAt(0);
  }

  return 100000 + total;
};

export class MockShippingProvider implements ShippingProvider {
  async createParcel(
    parcelData: ShippingParcelRequest,
  ): Promise<SendcloudParcel> {
    const parcelId = buildMockParcelId(
      `${parcelData.order_number}:${parcelData.address}:${parcelData.city}`,
    );

    return createMockParcel(parcelId, 'Mock Home Delivery');
  }

  async createParcelToServicePoint(
    parcelData: ShippingParcelRequest,
    servicePointId: string,
    shippingMethodId: number,
  ): Promise<SendcloudParcel> {
    const parcelId = buildMockParcelId(
      `${parcelData.order_number}:${servicePointId}:${shippingMethodId}`,
    );

    return createMockParcel(parcelId, 'Mock Pickup Delivery');
  }

  async getParcel(parcelId: number): Promise<SendcloudParcel> {
    return createMockParcel(parcelId, 'Mock Carrier');
  }

  async getShippingMethods(
    options?: ShippingMethodsOptions,
  ): Promise<SendcloudShippingMethod[]> {
    if (options?.servicePointId) {
      return MOCK_SHIPPING_METHODS.filter((method) => method.id >= 200);
    }

    return MOCK_SHIPPING_METHODS;
  }

  async cancelParcel(parcelId: number): Promise<unknown> {
    return {
      id: parcelId,
      status: 'cancelled',
    };
  }

  async getLabelUrl(parcelId: number): Promise<string> {
    return `https://labels.mock.sendcloud.dev/${parcelId}.pdf`;
  }

  async getPickupPoints(
    postcode: string,
    courier?: string,
  ): Promise<SendcloudPickupPoint[]> {
    const carrier = courier || 'mock-pickup';

    return [
      {
        id: 1,
        name: 'Mock Pickup Point One',
        street: '1 High Street',
        house_number: '1',
        city: 'London',
        postal_code: postcode,
        country: 'GB',
        carrier,
      },
      {
        id: 2,
        name: 'Mock Pickup Point Two',
        street: '2 High Street',
        house_number: '2',
        city: 'London',
        postal_code: postcode,
        country: 'GB',
        carrier,
      },
    ];
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const secret = sendcloudConfig.webhookSecret;

    if (!secret || !signature) {
      return false;
    }

    const expectedSignature = createSignature(rawBody, secret);
    return timingSafeCompare(expectedSignature, normaliseSignature(signature));
  }
}
