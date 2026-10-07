import { createFakeFirestore } from './helpers/fakeFirestore';

const fake = createFakeFirestore();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  get firestore() {
    return fake.firestore;
  },
}));

import { PaymentRecordRepository } from '../repositories/PaymentRecordRepository';
import { PaymentRecordInput } from '../model/PaymentRecord';

const paidInput = (
  overrides: Partial<PaymentRecordInput> = {},
): PaymentRecordInput => ({
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
  paidAt: new Date('2026-10-05T10:00:00Z'),
  lastStripeEventId: 'evt_1',
  ...overrides,
});

describe('PaymentRecordRepository.recordPayment', () => {
  const repo = new PaymentRecordRepository();

  beforeEach(() => fake.store.clear());

  it('stores a paid payment with no order yet', async () => {
    const result = await repo.recordPayment(paidInput());

    expect(result).toEqual({ orderId: null, keptExistingPaid: false });
    expect(fake.store.get('payments/pi_123')).toMatchObject({
      status: 'paid',
      orderId: null,
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
    });
  });

  it('attaches Stripe details to an order that already exists', async () => {
    fake.store.set('order_payment_intents/pi_123', { orderId: 'order-1' });
    fake.store.set('orders/order-1', { status: 'shipment_created' });

    const result = await repo.recordPayment(paidInput());

    expect(result.orderId).toBe('order-1');
    expect(fake.store.get('payments/pi_123')!.orderId).toBe('order-1');
    expect(fake.store.get('orders/order-1')).toMatchObject({
      status: 'shipment_created',
      paymentStatus: 'succeeded',
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
      paidAt: new Date('2026-10-05T10:00:00Z'),
    });
  });

  it('is safe when Stripe retries the same event', async () => {
    await repo.recordPayment(paidInput());
    const first = fake.store.get('payments/pi_123')!;

    await repo.recordPayment(paidInput());

    expect(fake.store.get('payments/pi_123')).toMatchObject({
      status: 'paid',
      firstReceivedAt: first.firstReceivedAt,
    });
    expect(fake.store.size).toBe(1);
  });

  it('never downgrades a paid payment to flagged', async () => {
    await repo.recordPayment(paidInput());

    const result = await repo.recordPayment(
      paidInput({
        status: 'flagged',
        flagReason: 'Payment amount does not match order amount',
        lastStripeEventId: 'evt_2',
      }),
    );

    expect(result.keptExistingPaid).toBe(true);
    expect(fake.store.get('payments/pi_123')).toMatchObject({
      status: 'paid',
      flagReason: null,
      lastStripeEventId: 'evt_1',
    });
  });

  it('does not touch the order for a flagged payment', async () => {
    fake.store.set('order_payment_intents/pi_123', { orderId: 'order-1' });
    fake.store.set('orders/order-1', { status: 'paid' });

    await repo.recordPayment(
      paidInput({
        status: 'flagged',
        flagReason: 'Payment currency must be GBP',
      }),
    );

    expect(fake.store.get('payments/pi_123')!.status).toBe('flagged');
    expect(fake.store.get('orders/order-1')).toEqual({ status: 'paid' });
  });

  it('skips the order update when the lock points at a missing order', async () => {
    fake.store.set('order_payment_intents/pi_123', { orderId: 'gone' });

    await expect(repo.recordPayment(paidInput())).resolves.toMatchObject({
      orderId: 'gone',
    });
    expect(fake.store.has('orders/gone')).toBe(false);
  });
});
