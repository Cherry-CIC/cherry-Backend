import crypto from 'crypto';
import { MockShippingProvider } from '../services/MockShippingProvider';

describe('MockShippingProvider', () => {
  const provider = new MockShippingProvider();

  it('returns only pickup-compatible methods when servicePointId is provided', async () => {
    const methods = await provider.getShippingMethods({
      servicePointId: 'pickup-123',
    });

    expect(methods).toHaveLength(1);
    expect(methods[0].id).toBe(201);
  });

  it('creates deterministic pickup-point parcel data', async () => {
    const parcel = await provider.createParcelToServicePoint(
      {
        name: 'Customer',
        address: '1 High Street',
        city: 'London',
        postal_code: 'SW1A1AA',
        country: 'GB',
        email: 'hello@example.com',
        order_number: 'order-123',
        weight: 1000,
      },
      'pickup-123',
      201,
    );

    expect(parcel.id).toBeGreaterThan(100000);
    expect(parcel.tracking_number).toContain('MOCK-TRACK');
    expect(parcel.label?.label_printer).toContain('.pdf');
  });

  it('verifies webhook signatures against the configured secret', () => {
    const rawBody = JSON.stringify({ action: 'parcel_status_changed' });
    const signature = crypto
      .createHmac('sha256', process.env.SENDCLOUD_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(provider.verifyWebhookSignature(rawBody, 'bad-signature')).toBe(
      false,
    );
  });
});
