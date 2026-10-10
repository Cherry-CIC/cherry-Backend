import { createFakeFirestore } from './helpers/fakeFirestore';

const fake = createFakeFirestore();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  get firestore() {
    return fake.firestore;
  },
}));

import {
  CreateOrderInput,
  OrderRepository,
} from '../../order/repositories/OrderRepository';

const orderInput: CreateOrderInput = {
  userId: 'buyer-1',
  email: 'buyer@example.com',
  productAmount: 2500,
  shippingFee: 399,
  securityFee: 250,
  totalAmount: 3149,
  currency: 'GBP',
  productId: 'product-1',
  productName: 'Wool coat',
  deliveryType: 'pickup_point',
  shippingOptionId: '3747',
  shippingOptionName: 'InPost locker',
  shippingCarrier: 'inpost_gb',
  shippingWeight: 2000,
  shipping: {
    address: {
      line1: '1 High St',
      city: 'London',
      postal_code: 'N1 1AA',
      country: 'GB',
    },
    name: 'Buyer',
    telephone: '07000000000',
  },
  pickupPoint: {
    id: 'pp-1',
    name: 'Locker',
    addressLine1: '1 High St',
    city: 'London',
    postalCode: 'N1 1AA',
    country: 'GB',
    carrier: 'inpost_gb',
  },
  paymentIntentId: 'pi_123',
  paymentStatus: 'succeeded',
  shipmentStatus: 'pending',
  status: 'paid',
};

describe('OrderRepository and webhook payment records', () => {
  const repo = new OrderRepository();

  beforeEach(() => {
    fake.store.clear();
    fake.store.set('products/product-1', {
      number: 1,
      status: 'active',
      price: 25,
    });
  });

  it('copies Stripe details when the webhook arrived first', async () => {
    const paidAt = new Date('2026-10-05T10:00:00Z');
    fake.store.set('payments/pi_123', {
      status: 'paid',
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
      paidAt,
      orderId: null,
    });

    const order = await repo.createPaidOrderAndDecrementInventory(orderInput);

    expect(order).toMatchObject({
      status: 'paid',
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
      paidAt,
    });
    expect(fake.store.get('payments/pi_123')!.orderId).toBe(order.id);
    expect(fake.store.get(`orders/${order.id}`)!.stripeChargeId).toBe('ch_123');
  });

  it('returns paidAt as a Date when Firestore gives back a Timestamp', async () => {
    const paidAt = new Date('2026-10-05T10:00:00Z');
    fake.store.set('payments/pi_123', {
      status: 'paid',
      stripeChargeId: 'ch_123',
      stripeBalanceTransactionId: 'txn_123',
      paidAt: { toDate: () => paidAt },
      orderId: null,
    });

    const order = await repo.createPaidOrderAndDecrementInventory(orderInput);

    expect(order.paidAt).toEqual(paidAt);
  });

  it('creates the order normally when no webhook has arrived yet', async () => {
    const order = await repo.createPaidOrderAndDecrementInventory(orderInput);

    expect(order.stripeChargeId).toBeUndefined();
    expect(fake.store.has('payments/pi_123')).toBe(false);
    expect(fake.store.get('order_payment_intents/pi_123')).toMatchObject({
      orderId: order.id,
    });
  });

  it('ignores flagged payment records', async () => {
    fake.store.set('payments/pi_123', {
      status: 'flagged',
      stripeChargeId: 'ch_bad',
      orderId: null,
    });

    const order = await repo.createPaidOrderAndDecrementInventory(orderInput);

    expect(order.stripeChargeId).toBeUndefined();
    expect(fake.store.get('payments/pi_123')!.orderId).toBe(order.id);
  });
});
