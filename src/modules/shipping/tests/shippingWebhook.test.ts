import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { handleSendcloudWebhook } from '../controllers/shippingController';

jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({ verifyIdToken: jest.fn() }),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

jest.mock('../repositories/ShipmentRepository');

import { ShipmentRepository } from '../repositories/ShipmentRepository';

const makeMockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res as Response;
};

const makeWebhookReq = (
  body: object,
  signature?: string,
  rawBody?: Buffer,
): Request =>
  ({
    body,
    headers: signature ? { 'sendcloud-signature': signature } : {},
    rawBody,
  }) as unknown as Request;

describe('handleSendcloudWebhook', () => {
  const originalSecret = process.env.SENDCLOUD_SECRET_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDCLOUD_SECRET_KEY = 'sendcloud-test-secret';
  });

  afterAll(() => {
    process.env.SENDCLOUD_SECRET_KEY = originalSecret;
  });

  it('rejects unsigned webhook requests', async () => {
    const res = makeMockRes();

    await handleSendcloudWebhook(
      makeWebhookReq({ action: 'parcel_status_changed' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('updates the shipment when the signature is valid', async () => {
    const res = makeMockRes();
    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'parcel_status_changed',
        parcel: {
          id: 42,
          status: { message: 'Delivered' },
          tracking_number: 'TN-001',
          tracking_url: 'https://track.example.com/TN-001',
        },
        timestamp: '2026-03-16T12:00:00Z',
      }),
      'utf8',
    );
    const signature = createHmac(
      'sha256',
      process.env.SENDCLOUD_SECRET_KEY!,
    )
      .update(rawBody)
      .digest('hex');

    (
      ShipmentRepository.prototype.getShipmentBySendcloudId as jest.Mock
    ).mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
    });
    (ShipmentRepository.prototype.updateShipment as jest.Mock).mockResolvedValue(
      undefined,
    );

    await handleSendcloudWebhook(
      makeWebhookReq(JSON.parse(rawBody.toString('utf8')), signature, rawBody),
      res,
    );

    expect(ShipmentRepository.prototype.getShipmentBySendcloudId).toHaveBeenCalledWith(
      42,
    );
    expect(ShipmentRepository.prototype.updateShipment).toHaveBeenCalledWith(
      'shipment-1',
      expect.objectContaining({
        status: 'delivered',
        trackingNumber: 'TN-001',
        trackingUrl: 'https://track.example.com/TN-001',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
