import crypto from 'crypto';
import { verifySendcloudWebhookSignature } from '../middleware/sendcloudWebhookAuth';

jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    webhookSignatureKey: 'test-webhook-secret',
    secretKey: 'test-api-secret',
  },
}));

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const signPayload = (payload: Buffer): string =>
  crypto
    .createHmac('sha256', 'test-webhook-secret')
    .update(payload)
    .digest('hex');

describe('verifySendcloudWebhookSignature', () => {
  it('allows requests with a valid Sendcloud signature', () => {
    const payload = Buffer.from(
      JSON.stringify({ action: 'parcel_status_changed' }),
    );
    const req: any = {
      rawBody: payload,
      body: JSON.parse(payload.toString()),
      get: jest.fn((header: string) =>
        header === 'Sendcloud-Signature' ? signPayload(payload) : undefined,
      ),
    };
    const res = createResponse();
    const next = jest.fn();

    verifySendcloudWebhookSignature(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects requests without a Sendcloud signature', () => {
    const req: any = {
      body: { action: 'parcel_status_changed' },
      get: jest.fn(),
    };
    const res = createResponse();
    const next = jest.fn();

    verifySendcloudWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects requests with an invalid Sendcloud signature', () => {
    const req: any = {
      body: { action: 'parcel_status_changed' },
      get: jest.fn((header: string) =>
        header === 'Sendcloud-Signature' ? 'not-a-valid-signature' : undefined,
      ),
    };
    const res = createResponse();
    const next = jest.fn();

    verifySendcloudWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a signature made with the API secret for classic integrations', () => {
    const payload = Buffer.from(JSON.stringify({ action: 'integration_updated' }));
    const req: any = {
      rawBody: payload,
      body: JSON.parse(payload.toString()),
      get: jest.fn((header: string) =>
        header === 'Sendcloud-Signature'
          ? crypto
              .createHmac('sha256', 'test-api-secret')
              .update(payload)
              .digest('hex')
          : undefined,
      ),
    };
    const res = createResponse();
    const next = jest.fn();

    verifySendcloudWebhookSignature(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
