const mockFirestore = {
  collection: jest.fn(),
  runTransaction: jest.fn(),
};

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: mockFirestore,
}));

import { OrderRepository } from '../repositories/OrderRepository';

describe('OrderRepository.finalizePendingOrder', () => {
  const orderData = {
    userId: 'buyer-1',
    sellerId: 'seller-1',
    charityId: 'charity-1',
    email: 'buyer@example.com',
    productAmount: 2500,
    shippingFee: 399,
    securityFee: 250,
    totalAmount: 3149,
    currency: 'GBP' as const,
    productId: 'product-1',
    productName: 'Winter Coat',
    deliveryType: 'pickup_point' as const,
    shippingOptionId: '3747',
    shippingOptionName: 'InPost locker',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 2000,
    shipping: {
      name: 'Buyer Name',
      telephone: '+447700900000',
      address: {
        line1: '10 High Street',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
    },
    pickupPoint: {
      id: '999',
      name: 'Locker A',
      addressLine1: '10 High Street',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
    },
    paymentIntentId: 'pi_123',
    paymentStatus: 'pending',
    status: 'pending_payment',
    shipmentStatus: 'pending',
    reservationActive: true,
    paymentExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
  const verifiedPayment = {
    userId: 'buyer-1', sellerId: 'seller-1', charityId: 'charity-1',
    productId: 'product-1', shippingMethodId: '3747',
    shippingMethodName: 'InPost locker', pickupPointId: '999',
    destinationCountry: 'GB', destinationPostalCode: 'SW1A 1AA',
    shippingCarrier: 'inpost_gb', shippingWeight: 2000,
    productAmount: 2500, shippingFee: 399, securityFee: 250,
    totalAmount: 3149, currency: 'GBP' as const,
  };

  let refs: Map<string, { collection: string; id: string }>;
  let transaction: {
    get: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    create: jest.Mock;
  };
  let orderDoc: { exists: boolean; data: () => typeof orderData };
  let paymentLockDoc: { exists: boolean; data: () => { orderId: string } };
  let fulfillmentJobDoc: { exists: boolean };

  beforeEach(() => {
    jest.clearAllMocks();
    refs = new Map();
    mockFirestore.collection.mockImplementation((collection: string) => ({
      doc: (id: string) => {
        const key = `${collection}/${id}`;
        if (!refs.has(key)) {
          refs.set(key, { collection, id });
        }
        return refs.get(key);
      },
    }));
    orderDoc = { exists: true, data: () => orderData };
    paymentLockDoc = { exists: false, data: () => ({ orderId: '' }) };
    fulfillmentJobDoc = { exists: false };
    transaction = {
      get: jest.fn(async (ref: { collection: string }) => {
        if (ref.collection === 'orders') {
          return orderDoc;
        }
        if (ref.collection === 'order_payment_intents') {
          return paymentLockDoc;
        }
        if (ref.collection === 'order_fulfillment_jobs') {
          return fulfillmentJobDoc;
        }
        if (ref.collection === 'products') {
          return {
            exists: true,
            data: () => ({ number: 1, status: 'active' }),
          };
        }
        throw new Error(`Unexpected collection: ${ref.collection}`);
      }),
      update: jest.fn(),
      set: jest.fn(),
      create: jest.fn(),
    };
    mockFirestore.runTransaction.mockImplementation(
      (callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
    );
  });

  it('atomically marks the order paid and creates its fulfillment job', async () => {
    const result = await new OrderRepository().finalizePendingOrder(
      'order-1',
      'pi_123',
      verifiedPayment,
    );

    const jobRef = refs.get('order_fulfillment_jobs/order-1');
    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-1',
        paymentIntentId: 'pi_123',
        paymentStatus: 'succeeded',
        status: 'paid',
        payoutStatus: 'held',
      }),
    );
    expect(transaction.create).toHaveBeenCalledWith(
      jobRef,
      expect.objectContaining({
        orderId: 'order-1',
        status: 'pending',
        shipmentCompleted: false,
      }),
    );
    expect(transaction.set).toHaveBeenCalledWith(
      refs.get('order_payment_intents/pi_123'),
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });

  it('reconciles an existing payment lock without creating another job', async () => {
    orderDoc = {
      exists: true,
      data: () => ({
        ...orderData,
        paymentIntentId: 'pi_123',
        paymentStatus: 'succeeded',
        status: 'paid',
      }),
    };
    paymentLockDoc = {
      exists: true,
      data: () => ({ orderId: 'order-1' }),
    };
    fulfillmentJobDoc = { exists: true };

    const result = await new OrderRepository().finalizePendingOrder(
      'order-1',
      'pi_123',
      verifiedPayment,
    );

    expect(result.status).toBe('paid');
    expect(transaction.create).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('rejects changed order values inside the transaction', async () => {
    await expect(
      new OrderRepository().finalizePendingOrder('order-1', 'pi_123', {
        ...verifiedPayment,
        totalAmount: 9999,
      }),
    ).rejects.toThrow('Pending order does not match verified payment');

    expect(transaction.update).toHaveBeenCalledWith(
      refs.get('orders/order-1'),
      expect.objectContaining({
        paymentIntentId: 'pi_123',
        paymentStatus: 'failed',
        status: 'failed',
        reservationActive: false,
      }),
    );
    expect(transaction.set).not.toHaveBeenCalled();
  });
});
