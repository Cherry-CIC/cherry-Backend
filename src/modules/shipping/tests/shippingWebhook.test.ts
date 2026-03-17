jest.mock('../repositories/ShipmentRepository');
jest.mock('../services/ShippingProviderFactory', () => ({
  createShippingProvider: jest.fn(),
}));

import { Request, Response } from 'express';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { handleSendcloudWebhook } from '../controllers/shippingController';
import { createShippingProvider } from '../services/ShippingProviderFactory';

const makeResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('handleSendcloudWebhook', () => {
  const mockProvider = {
    createParcel: jest.fn(),
    createParcelToServicePoint: jest.fn(),
    getParcel: jest.fn(),
    getShippingMethods: jest.fn(),
    cancelParcel: jest.fn(),
    getLabelUrl: jest.fn(),
    getPickupPoints: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createShippingProvider as jest.Mock).mockReturnValue(mockProvider);
  });

  it('returns 400 when the webhook signature is invalid', async () => {
    mockProvider.verifyWebhookSignature.mockReturnValue(false);

    const request = {
      headers: {
        'sendcloud-signature': 'bad-signature',
      },
      rawBody: Buffer.from('{}'),
      body: {},
    } as unknown as Request;
    const response = makeResponse();

    await handleSendcloudWebhook(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(ShipmentRepository.prototype.updateShipment).not.toHaveBeenCalled();
  });

  it('ignores stale webhook updates', async () => {
    mockProvider.verifyWebhookSignature.mockReturnValue(true);
    (
      ShipmentRepository.prototype.getShipmentBySendcloudId as jest.Mock
    ).mockResolvedValue({
      id: 'shipment-1',
      lastWebhookTimestamp: new Date('2026-03-17T10:00:00.000Z'),
    });

    const request = {
      headers: {
        'sendcloud-signature': 'valid-signature',
      },
      rawBody: Buffer.from('{}'),
      body: {
        action: 'parcel_status_changed',
        timestamp: '2026-03-17T09:00:00.000Z',
        parcel: {
          id: 42,
          status: { message: 'Delivered' },
        },
      },
    } as unknown as Request;
    const response = makeResponse();

    await handleSendcloudWebhook(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ received: true, ignored: true });
    expect(ShipmentRepository.prototype.updateShipment).not.toHaveBeenCalled();
  });

  it('updates shipments for newer signed webhook events', async () => {
    mockProvider.verifyWebhookSignature.mockReturnValue(true);
    (
      ShipmentRepository.prototype.getShipmentBySendcloudId as jest.Mock
    ).mockResolvedValue({
      id: 'shipment-1',
      lastWebhookTimestamp: new Date('2026-03-17T09:00:00.000Z'),
    });
    (ShipmentRepository.prototype.updateShipment as jest.Mock).mockResolvedValue(
      undefined,
    );

    const request = {
      headers: {
        'sendcloud-signature': 'valid-signature',
      },
      rawBody: Buffer.from('{}'),
      body: {
        action: 'parcel_status_changed',
        timestamp: '2026-03-17T10:00:00.000Z',
        parcel: {
          id: 42,
          tracking_number: 'TRACK-42',
          tracking_url: 'https://track.example/42',
          status: { message: 'Delivered' },
        },
      },
    } as unknown as Request;
    const response = makeResponse();

    await handleSendcloudWebhook(request, response);

    expect(ShipmentRepository.prototype.updateShipment).toHaveBeenCalledWith(
      'shipment-1',
      expect.objectContaining({
        status: 'delivered',
        trackingNumber: 'TRACK-42',
        trackingUrl: 'https://track.example/42',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
