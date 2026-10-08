import {
  CreateOrderInput,
  OrderRepository,
} from '../repositories/OrderRepository';
import {
  CheckoutContextRepository,
  assertNoUnresolvedCheckouts,
} from '../../payment/CheckoutContextRepository';

const mockDocuments = new Map<string, Record<string, any>>();
const mockWrites: Array<{ path: string; data: Record<string, any> }> = [];
const mockAssertAccountsActive = jest.fn();
const mockSnapshot = (path: string) => ({
  exists: mockDocuments.has(path),
  id: path.split('/').pop(),
  data: () => mockDocuments.get(path),
  get: (field: string) => mockDocuments.get(path)?.[field],
});
const mockTransaction = {
  get: jest.fn(async (ref: { path: string }) => mockSnapshot(ref.path)),
  update: jest.fn((ref: { path: string }, data: Record<string, any>) => {
    mockWrites.push({ path: ref.path, data });
    mockDocuments.set(ref.path, { ...mockDocuments.get(ref.path), ...data });
  }),
  set: jest.fn((ref: { path: string }, data: Record<string, any>) => {
    mockWrites.push({ path: ref.path, data });
    mockDocuments.set(ref.path, data);
  }),
  create: jest.fn((ref: { path: string }, data: Record<string, any>) => {
    mockWrites.push({ path: ref.path, data });
    mockDocuments.set(ref.path, data);
  }),
};

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: (name: string) => ({
      doc: (id = 'generated-id') => ({
        path: `${name}/${id}`,
        id,
        get: async () => mockSnapshot(`${name}/${id}`),
      }),
    }),
    runTransaction: (
      operation: (tx: typeof mockTransaction) => Promise<unknown>,
    ) => operation(mockTransaction),
  },
}));
jest.mock('../../account-deletion/access', () => ({
  assertAccountsActive: (...args: unknown[]) =>
    mockAssertAccountsActive(...args),
}));

const repository = new OrderRepository();
const dispute = () => ({
  buyerDisputeStatus: 'under_review' as const,
  buyerDisputeReason: 'wrong_item' as const,
  buyerDisputeMessage: 'The item differs from the listing.',
  buyerDisputedAt: new Date(),
});
const seedRetainedOrder = (extra: Record<string, unknown> = {}) => {
  mockDocuments.set('orders/order', {
    userId: 'buyer',
    sellerId: 'deleted:request',
    status: 'delivered',
    deletionMinimised: true,
    totalAmount: 1200,
    ...extra,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDocuments.clear();
  mockWrites.length = 0;
  mockAssertAccountsActive.mockResolvedValue(undefined);
});

test('late provider updates cannot restore erased information', async () => {
  seedRetainedOrder();
  expect(
    await repository.updateOrder('order', {
      email: 'removed@example.test',
      status: 'shipped',
    }),
  ).toBe(false);
  expect(mockWrites).toEqual([]);
});

test('continuing buyer can open a dispute after seller minimisation without restoring other fields', async () => {
  seedRetainedOrder();
  expect(await repository.updateOrder('order', dispute(), 'buyer')).toBe(true);
  expect(mockDocuments.get('orders/order')).toMatchObject({
    buyerDisputeStatus: 'under_review',
    totalAmount: 1200,
  });
  expect(mockDocuments.get('orders/order')?.email).toBeUndefined();
  expect(mockAssertAccountsActive).toHaveBeenCalledWith(mockTransaction, [
    'buyer',
  ]);
  expect(await repository.updateOrder('order', dispute(), 'buyer')).toBe(false);
});

test('continuing buyer can confirm receipt after seller minimisation', async () => {
  seedRetainedOrder();
  expect(
    await repository.updateOrder(
      'order',
      {
        buyerConfirmedReceived: true,
        buyerConfirmedReceivedAt: new Date(),
        status: 'delivered',
      },
      'buyer',
    ),
  ).toBe(true);
  expect(mockDocuments.get('orders/order')?.buyerConfirmedReceived).toBe(true);
});

test.each([
  ['another buyer', { userId: 'other' }],
  ['expired retention', { retentionExpired: true }],
  ['not yet delivered', { status: 'shipped' }],
])('buyer updates reject %s', async (_reason, fields) => {
  seedRetainedOrder(fields);
  expect(await repository.updateOrder('order', dispute(), 'buyer')).toBe(false);
  expect(mockWrites).toEqual([]);
});

test('buyer action cannot smuggle erased contact fields into a minimised order', async () => {
  seedRetainedOrder();
  expect(
    await repository.updateOrder(
      'order',
      { ...dispute(), email: 'restored@example.test' },
      'buyer',
    ),
  ).toBe(false);
  expect(mockWrites).toEqual([]);
});

test('closure racing a buyer action is rejected inside the transaction', async () => {
  seedRetainedOrder();
  mockAssertAccountsActive.mockRejectedValue(
    new Error('Account closed for deletion'),
  );
  await expect(
    repository.updateOrder('order', dispute(), 'buyer'),
  ).rejects.toThrow('closed for deletion');
  expect(mockWrites).toEqual([]);
});

const paidOrder = (): CreateOrderInput => ({
  checkoutSessionId: 'checkout',
  userId: 'buyer',
  email: 'buyer@example.test',
  productAmount: 1000,
  shippingFee: 100,
  securityFee: 100,
  totalAmount: 1200,
  currency: 'GBP',
  productId: 'product',
  productName: 'Removed listing',
  deliveryType: 'pickup_point',
  shippingOptionId: 'method',
  shippingOptionName: 'Locker',
  shippingCarrier: 'inpost_gb',
  shippingWeight: 1000,
  shipping: {
    name: 'Buyer',
    telephone: '01234',
    address: {
      line1: 'Street',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
  },
  pickupPoint: {
    id: 'point',
    name: 'Locker',
    addressLine1: 'Street',
    city: 'London',
    postalCode: 'SW1A 1AA',
    country: 'GB',
  },
  paymentIntentId: 'pi_paid',
  paymentStatus: 'succeeded',
  shipmentStatus: 'pending',
  status: 'paid',
});
const seedPaidCheckout = () => {
  mockDocuments.set('products/product', {
    userId: 'seller',
    status: 'active',
    number: 1,
    price: 999,
    name: 'Removed listing',
  });
  mockDocuments.set('account_checkout_contexts/checkout', {
    buyerUid: 'buyer',
    sellerUid: 'seller',
    productId: 'product',
    paymentIntentId: 'pi_paid',
    state: 'succeeded',
    snapshotVersion: 1,
    charityId: 'original-charity',
    productName: 'Original coat',
    metadata: {
      productAmount: '1000',
      shippingFee: '100',
      securityFee: '100',
      totalAmount: '1200',
      shippingWeight: '1000',
    },
  });
};

test('already-paid checkout completes from its immutable snapshot after account closure', async () => {
  seedPaidCheckout();
  mockAssertAccountsActive.mockRejectedValue(new Error('closed'));
  const order =
    await repository.createPaidOrderAndDecrementInventory(paidOrder());
  expect(order.productName).toBe('Original coat');
  expect(mockDocuments.get(`orders/${order.id}`)?.charityId).toBe(
    'original-charity',
  );
  expect(mockDocuments.get('products/product')).toMatchObject({
    number: 0,
    status: 'sold',
  });
  expect(mockDocuments.get('account_checkout_contexts/checkout')).toMatchObject(
    { state: 'fulfilled', orderId: order.id },
  );
  expect(mockAssertAccountsActive).not.toHaveBeenCalled();
  await expect(
    repository.createPaidOrderAndDecrementInventory(paidOrder()),
  ).rejects.toThrow('already been used');
});

test.each(['unlisted', 'sold'])(
  'new checkout rejects a %s listing before provider work',
  async (status) => {
    mockDocuments.set('products/product', {
      userId: 'seller',
      number: 1,
      price: 10,
      status,
    });
    await expect(
      new CheckoutContextRepository().start({
        buyerUid: 'buyer',
        sellerUid: 'seller',
        productId: 'product',
        productName: 'Coat',
        buyerEmail: 'buyer@example.test',
        metadata: { productAmount: '1000' },
      }),
    ).rejects.toThrow('Product is unavailable');
    expect(mockWrites).toEqual([]);
  },
);

test('unresolved checkout guard uses the explicitly supplied database', async () => {
  const query = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  const db = { collection: jest.fn(() => query) };
  const tx = { get: jest.fn(async () => ({ empty: false })) };
  await expect(
    assertNoUnresolvedCheckouts(tx as any, 'product', db as any),
  ).rejects.toThrow('unresolved checkout');
  expect(db.collection).toHaveBeenCalledWith('account_checkout_contexts');
  expect(tx.get).toHaveBeenCalledWith(query);
});
