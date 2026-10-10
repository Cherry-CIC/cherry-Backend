const mockRetrieveCharge = jest.fn();

jest.mock('../../../shared/config/stripeConfig', () => ({
  stripe: { charges: { retrieve: mockRetrieveCharge } },
}));

jest.mock('../repositories/PaymentRecordRepository', () => ({
  PaymentRecordRepository: jest.fn(),
}));

import { StripeWebhookService } from '../services/StripeWebhookService';

const checkoutMetadata = {
  firebaseUid: 'buyer-1',
  productId: 'product-1',
  shippingMethodId: '3747',
  shippingMethodName: 'InPost locker',
  pickupPointId: 'pp-1',
  destinationCountry: 'GB',
  destinationPostalCode: 'N1 1AA',
  shippingCarrier: 'inpost_gb',
  shippingWeight: '2000',
  productAmount: '2500',
  shippingFee: '399',
  securityFee: '250',
  totalAmount: '3149',
};

const succeededEvent = (paymentIntent: Record<string, unknown> = {}): any => ({
  id: 'evt_1',
  type: 'payment_intent.succeeded',
  created: 1_791_000_000,
  data: {
    object: {
      id: 'pi_123',
      status: 'succeeded',
      amount: 3149,
      currency: 'gbp',
      latest_charge: 'ch_123',
      metadata: { ...checkoutMetadata },
      ...paymentIntent,
    },
  },
});

describe('StripeWebhookService', () => {
  const recordPayment = jest.fn();
  const service = new StripeWebhookService({ recordPayment } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    recordPayment.mockResolvedValue({
      orderId: null,
      keptExistingPaid: false,
    });
    mockRetrieveCharge.mockResolvedValue({
      id: 'ch_123',
      balance_transaction: 'txn_123',
      created: 1_790_999_990,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('records a valid payment as paid with Stripe transaction details', async () => {
    recordPayment.mockResolvedValue({
      orderId: 'order-1',
      keptExistingPaid: false,
    });

    const outcome = await service.handleEvent(succeededEvent());

    expect(outcome).toEqual({
      action: 'recorded',
      status: 'paid',
      paymentIntentId: 'pi_123',
      orderId: 'order-1',
      flagReason: null,
    });
    expect(recordPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_123',
      status: 'paid',
      flagReason: null,
      firebaseUid: 'buyer-1',
      productId: 'product-1',
      amount: 3149,
      currency: 'gbp',
      productAmount: 2500,
      shippingFee: 399,
      securityFee: 250,
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
      paidAt: new Date(1_790_999_990 * 1000),
      lastStripeEventId: 'evt_1',
    });
  });

  it('flags a payment whose amount differs from checkout pricing', async () => {
    const outcome = await service.handleEvent(succeededEvent({ amount: 100 }));

    expect(outcome).toMatchObject({
      status: 'flagged',
      flagReason: 'Payment amount does not match order amount',
    });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'flagged',
        productAmount: null,
        amount: 100,
      }),
    );
  });

  it('flags payments with inconsistent pricing metadata', async () => {
    const outcome = await service.handleEvent(
      succeededEvent({
        metadata: { ...checkoutMetadata, securityFee: '1' },
      }),
    );

    expect(outcome).toMatchObject({
      status: 'flagged',
      flagReason: 'Payment pricing metadata is inconsistent',
    });
  });

  it('flags non-GBP payments', async () => {
    const outcome = await service.handleEvent(
      succeededEvent({ currency: 'usd' }),
    );

    expect(outcome).toMatchObject({
      status: 'flagged',
      flagReason: 'Payment currency must be GBP',
    });
  });

  it('flags payments that were not created by cherry checkout', async () => {
    const outcome = await service.handleEvent(succeededEvent({ metadata: {} }));

    expect(outcome).toMatchObject({
      status: 'flagged',
      flagReason: 'Payment has no cherry buyer attached',
    });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ firebaseUid: null, productId: null }),
    );
  });

  it('still records the payment when the charge lookup fails', async () => {
    mockRetrieveCharge.mockRejectedValue(new Error('Stripe unavailable'));

    const outcome = await service.handleEvent(succeededEvent());

    expect(outcome).toMatchObject({ status: 'paid' });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeChargeId: 'ch_123',
        stripeBalanceTransactionId: null,
        paidAt: new Date(1_791_000_000 * 1000),
      }),
    );
  });

  it('uses an expanded charge without calling Stripe again', async () => {
    await service.handleEvent(
      succeededEvent({
        latest_charge: {
          id: 'ch_9',
          balance_transaction: { id: 'txn_9' },
          created: 1_790_000_000,
        },
      }),
    );

    expect(mockRetrieveCharge).not.toHaveBeenCalled();
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeChargeId: 'ch_9',
        stripeBalanceTransactionId: 'txn_9',
      }),
    );
  });

  it('reads the charge from the legacy charges list on older API versions', async () => {
    await service.handleEvent(
      succeededEvent({
        latest_charge: undefined,
        charges: {
          data: [
            {
              id: 'ch_old',
              balance_transaction: 'txn_old',
              created: 1_790_000_000,
            },
          ],
        },
      }),
    );

    expect(mockRetrieveCharge).not.toHaveBeenCalled();
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeChargeId: 'ch_old',
        stripeBalanceTransactionId: 'txn_old',
      }),
    );
  });

  it('records the payment without charge IDs when Stripe sends none', async () => {
    await service.handleEvent(succeededEvent({ latest_charge: null }));

    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        stripeChargeId: null,
        stripeBalanceTransactionId: null,
        paidAt: new Date(1_791_000_000 * 1000),
      }),
    );
  });

  it('reports paid when an existing paid record was kept', async () => {
    recordPayment.mockResolvedValue({
      orderId: 'order-1',
      keptExistingPaid: true,
    });

    const outcome = await service.handleEvent(succeededEvent({ amount: 1 }));

    expect(outcome).toMatchObject({ status: 'paid', flagReason: null });
  });

  it('ignores event types it does not handle', async () => {
    const outcome = await service.handleEvent({
      id: 'evt_2',
      type: 'customer.created',
      data: { object: {} },
    } as any);

    expect(outcome).toEqual({
      action: 'ignored',
      eventType: 'customer.created',
    });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('lets storage errors propagate so Stripe retries', async () => {
    recordPayment.mockRejectedValue(new Error('Firestore unavailable'));

    await expect(service.handleEvent(succeededEvent())).rejects.toThrow(
      'Firestore unavailable',
    );
  });
});
