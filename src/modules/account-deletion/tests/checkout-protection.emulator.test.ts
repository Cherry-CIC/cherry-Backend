import { randomUUID } from 'crypto';
import { firestore } from '../../../shared/config/firebaseConfig';
import { CheckoutContextRepository } from '../../payment/CheckoutContextRepository';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import {
  CreateOrderInput,
  OrderRepository,
} from '../../order/repositories/OrderRepository';

const contexts = new CheckoutContextRepository();
const products = new ProductRepository();
let productId: string;
let buyerUid: string;
let sellerUid: string;
let postageSize: string;
const metadata = {
  productAmount: '1000',
  shippingFee: '300',
  securityFee: '100',
  totalAmount: '1400',
  shippingWeight: '1000',
};
const selection = () => ({
  buyerUid,
  sellerUid,
  productId,
  productName: 'Original coat',
  buyerEmail: 'buyer@example.test',
  metadata,
});
const orderInput = (checkoutSessionId: string): CreateOrderInput => ({
  checkoutSessionId,
  userId: buyerUid,
  email: 'buyer@example.test',
  productId,
  productName: 'Removed listing',
  productAmount: 1000,
  shippingFee: 300,
  securityFee: 100,
  totalAmount: 1400,
  currency: 'GBP',
  deliveryType: 'pickup_point',
  shippingOptionId: 'shipping',
  shippingOptionName: 'Locker',
  shippingCarrier: 'inpost_gb',
  shippingWeight: 1000,
  shipping: {
    name: 'Buyer',
    telephone: '07000000000',
    address: {
      line1: 'Example',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
  },
  pickupPoint: {
    id: 'point',
    name: 'Locker',
    addressLine1: 'Example',
    city: 'London',
    postalCode: 'SW1A 1AA',
    country: 'GB',
    carrier: 'inpost_gb',
  },
  paymentIntentId: `pi_${checkoutSessionId}`,
  paymentStatus: 'succeeded',
  shipmentStatus: 'pending',
  status: 'paid',
});

beforeEach(async () => {
  const suffix = randomUUID();
  productId = `protected-${suffix}`;
  buyerUid = `buyer-${suffix}`;
  sellerUid = `seller-${suffix}`;
  postageSize = `postage-${suffix}`;
  await firestore.doc(`postage_sizes/${postageSize}`).set({ weight: 1000 });
  await firestore.doc(`products/${productId}`).set({
    userId: sellerUid,
    name: 'Original coat',
    price: 10,
    number: 1,
    charityId: 'original-charity',
    postageSize,
    donation: 10,
    description: 'Original description',
  });
});
afterAll(async () => {
  await firestore.terminate();
});

test('unresolved checkout protects financial fields and deletion while harmless edits remain available', async () => {
  await contexts.start(selection());
  for (const change of [
    { price: 11 },
    { number: 0 },
    { charityId: 'another-charity' },
    { postageSize: 'different' },
    { donation: 11 },
  ]) {
    await expect(products.update(productId, change)).rejects.toThrow(
      'unresolved checkout',
    );
  }
  await expect(products.delete(productId)).rejects.toThrow(
    'unresolved checkout',
  );
  await products.update(productId, {
    description: 'Corrected description',
    price: 10,
  });
  expect(
    (await firestore.doc(`products/${productId}`).get()).data(),
  ).toMatchObject({
    price: 10,
    number: 1,
    charityId: 'original-charity',
    postageSize,
    description: 'Corrected description',
  });
});

test('verified terminal cancellation releases listing mutation protection', async () => {
  const id = await contexts.start(selection());
  await contexts.recordProviderState(id, `pi_${id}`, 'cancelled', {
    firebaseUid: buyerUid,
    productId,
  });
  await products.update(productId, { price: 12 });
  expect(await products.delete(productId)).toBe(true);
});

test('concurrent checkout and price change cannot both commit inconsistent pricing', async () => {
  const results = await Promise.allSettled([
    contexts.start(selection()),
    products.update(productId, { price: 11 }),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const product = await firestore.doc(`products/${productId}`).get();
  if (results[0].status === 'fulfilled') {
    expect(product.get('price')).toBe(10);
    expect((await contexts.get(results[0].value))?.metadata.productAmount).toBe(
      '1000',
    );
  } else {
    expect(product.get('price')).toBe(11);
  }
});

test('concurrent checkout and deletion cannot leave an accepted checkout without its product', async () => {
  const results = await Promise.allSettled([
    contexts.start(selection()),
    products.delete(productId),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect((await firestore.doc(`products/${productId}`).get()).exists).toBe(
    results[0].status === 'fulfilled',
  );
});

test('a postage definition changed after quoting is rejected before checkout context exists', async () => {
  await firestore.doc(`postage_sizes/${postageSize}`).update({ weight: 2000 });
  await expect(contexts.start(selection())).rejects.toThrow(
    'Product postage size changed',
  );
  expect(
    (
      await firestore
        .collection('account_checkout_contexts')
        .where('productId', '==', productId)
        .get()
    ).empty,
  ).toBe(true);
});

test('paid support completion survives closure with original allocation and atomically recorded evidence', async () => {
  const id = await contexts.start(selection());
  await contexts.attachPayment(id, `pi_${id}`, 'cus_test');
  await firestore
    .doc(`account_deletion_guards/${buyerUid}`)
    .set({ blocked: true });
  await firestore
    .doc(`account_deletion_guards/${sellerUid}`)
    .set({ blocked: true });
  // Simulate a minimised listing and an out-of-band catalogue edit. The accepted
  // allocation and charged amount must still come from the trusted snapshot.
  await firestore.doc(`products/${productId}`).update({
    name: 'Removed listing',
    charityId: 'changed-charity',
    price: 99,
  });
  const repository = new OrderRepository();
  const supportReview = {
    reviewer: 'verified-support',
    evidenceReference: 'restricted-case-123',
  };
  await expect(
    repository.createPaidOrderAndDecrementInventory({
      ...orderInput(id),
      productAmount: 999,
      supportReview,
    }),
  ).rejects.toThrow('Paid selection does not match checkout context');
  expect(
    (await firestore.doc(`account_checkout_contexts/${id}`).get()).get(
      'supportEvidence',
    ),
  ).toBeUndefined();
  expect(
    (await firestore.doc(`order_payment_intents/pi_${id}`).get()).exists,
  ).toBe(false);

  const order = await repository.createPaidOrderAndDecrementInventory({
    ...orderInput(id),
    supportReview,
  });
  const savedOrder = await firestore.doc(`orders/${order.id}`).get();
  const context = await firestore.doc(`account_checkout_contexts/${id}`).get();
  expect(savedOrder.data()).toMatchObject({
    charityId: 'original-charity',
    productAmount: 1000,
    productName: 'Original coat',
    sellerId: sellerUid,
  });
  expect(context.data()).toMatchObject({
    state: 'fulfilled',
    orderId: order.id,
    supportReviewer: supportReview.reviewer,
    supportEvidence: supportReview.evidenceReference,
  });
  expect(context.get('supportReviewedAt')).toBeDefined();
  expect(
    (await firestore.doc(`products/${productId}`).get()).get('number'),
  ).toBe(0);
  await expect(
    repository.createPaidOrderAndDecrementInventory({
      ...orderInput(id),
      supportReview,
    }),
  ).rejects.toThrow('PaymentIntent has already been used');
  expect(
    (await firestore.doc(`products/${productId}`).get()).get('number'),
  ).toBe(0);
});
