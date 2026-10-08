import { firestore } from '../../../shared/config/firebaseConfig';
import { gbpToPence } from '../../../shared/utils/money';
import { Order } from '../model/Order';
import { assertAccountsActive } from '../../account-deletion/access';

const removeUndefinedValues = <T extends Record<string, unknown>>(
  value: T,
): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;

export interface CreateOrderInput {
  checkoutSessionId?: string;
  supportReview?: { reviewer: string; evidenceReference: string };
  userId: string;
  email: string;
  productAmount: number;
  shippingFee: number;
  securityFee: number;
  totalAmount: number;
  currency: 'GBP';
  productId: string;
  productName: string;
  deliveryType: Order['deliveryType'];
  shippingOptionId: string;
  shippingOptionName: string;
  shippingCarrier: string;
  shippingWeight: number;
  shipping: Order['shipping'];
  pickupPoint: Order['pickupPoint'];
  paymentIntentId: string;
  paymentStatus: Order['paymentStatus'];
  shipmentStatus: Order['shipmentStatus'];
  status: Order['status'];
  shipmentId?: string;
}

export class OrderRepository {
  async createPaidOrderAndDecrementInventory(
    input: CreateOrderInput,
  ): Promise<Order> {
    const orderRef = firestore.collection('orders').doc();
    const paymentLockRef = firestore
      .collection('order_payment_intents')
      .doc(input.paymentIntentId);
    const productRef = firestore.collection('products').doc(input.productId);

    return firestore.runTransaction(async (transaction) => {
      const [paymentLock, productDoc] = await Promise.all([
        transaction.get(paymentLockRef),
        transaction.get(productRef),
      ]);

      if (paymentLock.exists) {
        throw new Error('PaymentIntent has already been used');
      }

      if (!productDoc.exists) {
        throw new Error('Product not found');
      }

      const productData = productDoc.data()!;
      const sellerId = productData.userId;
      const contextRef = input.checkoutSessionId
        ? firestore
            .collection('account_checkout_contexts')
            .doc(input.checkoutSessionId)
        : null;
      const context = contextRef ? await transaction.get(contextRef) : null;
      const checkout = context?.data();
      if (contextRef) {
        const data = checkout;
        if (
          !data ||
          data.buyerUid !== input.userId ||
          data.sellerUid !== sellerId ||
          data.productId !== input.productId ||
          data.paymentIntentId !== input.paymentIntentId ||
          !['open', 'succeeded', 'needs_review'].includes(data.state)
        )
          throw new Error('Checkout context is invalid');
        for (const key of [
          'productAmount',
          'shippingFee',
          'securityFee',
          'totalAmount',
          'shippingWeight',
        ] as const) {
          if (Number(data.metadata?.[key]) !== input[key])
            throw new Error('Paid selection does not match checkout context');
        }
        if (
          data.snapshotVersion !== 1 ||
          !Object.prototype.hasOwnProperty.call(data, 'charityId')
        ) {
          throw new Error('Checkout allocation requires review');
        }
      } else {
        await assertAccountsActive(transaction, [input.userId, sellerId]);
      }
      const quantity =
        typeof productData.number === 'number' ? productData.number : 0;
      const productStatus =
        typeof productData.status === 'string' ? productData.status : 'active';
      if (quantity <= 0) {
        throw new Error('Product is out of stock');
      }

      if (productStatus !== 'active') {
        throw new Error('Product is not available');
      }

      if (
        !checkout &&
        (typeof productData.price !== 'number' ||
          gbpToPence(productData.price) !== input.productAmount)
      ) {
        throw new Error('Product price changed');
      }

      if (
        input.supportReview &&
        (typeof input.supportReview.reviewer !== 'string' ||
          input.supportReview.reviewer.trim().length < 3 ||
          input.supportReview.reviewer.length > 200 ||
          typeof input.supportReview.evidenceReference !== 'string' ||
          input.supportReview.evidenceReference.trim().length < 8 ||
          input.supportReview.evidenceReference.length > 500 ||
          !contextRef)
      )
        throw new Error('Verified support evidence is required');
      const orderData = this.buildOrderData({
        ...input,
        productName: checkout?.productName || input.productName,
      });
      transaction.set(orderRef, {
        ...orderData,
        sellerId,
        charityId: checkout
          ? checkout.charityId
          : productData.charityId || null,
        email: input.email,
      });
      transaction.update(productRef, {
        number: quantity - 1,
        status: quantity - 1 <= 0 ? 'sold' : 'active',
        updatedAt: new Date(),
      });
      transaction.set(paymentLockRef, {
        orderId: orderRef.id,
        userId: input.userId,
        createdAt: new Date(),
      });
      if (contextRef)
        transaction.update(contextRef, {
          state: 'fulfilled',
          orderId: orderRef.id,
          ...(input.supportReview
            ? {
                supportReviewer: input.supportReview.reviewer,
                supportEvidence: input.supportReview.evidenceReference,
                supportReviewedAt: new Date(),
              }
            : {}),
          updatedAt: new Date(),
        });

      return {
        id: orderRef.id,
        email: input.email,
        ...orderData,
      } as Order;
    });
  }

  private buildOrderData(input: CreateOrderInput): Omit<Order, 'id' | 'email'> {
    return removeUndefinedValues({
      userId: input.userId,
      productAmount: input.productAmount,
      shippingFee: input.shippingFee,
      securityFee: input.securityFee,
      totalAmount: input.totalAmount,
      currency: input.currency,
      productId: input.productId,
      productName: input.productName,
      deliveryType: input.deliveryType,
      shippingOptionId: input.shippingOptionId,
      shippingOptionName: input.shippingOptionName,
      shippingCarrier: input.shippingCarrier,
      shippingWeight: input.shippingWeight,
      shipping: input.shipping,
      pickupPoint: input.pickupPoint,
      paymentIntentId: input.paymentIntentId,
      paymentStatus: input.paymentStatus,
      shipmentStatus: input.shipmentStatus,
      status: input.status,
      shipmentId: input.shipmentId,
      createdAt: new Date(),
    }) as Omit<Order, 'id' | 'email'>;
  }

  async getOrderById(id: string): Promise<Order | null> {
    const doc = await firestore.collection('orders').doc(id).get();
    if (!doc.exists) {
      return null;
    }
    return this.mapToOrder(doc.id, doc.data()!);
  }

  async updateOrder(
    id: string,
    updates: Partial<Order>,
    buyerUid?: string,
  ): Promise<boolean> {
    const ref = firestore.collection('orders').doc(id);
    return firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return false;
      if (buyerUid) {
        // The continuing buyer may still exercise receipt and dispute rights
        // after seller deletion. Serialise with closure and retention expiry.
        await assertAccountsActive(transaction, [buyerUid]);
        if (
          doc.get('userId') !== buyerUid ||
          doc.get('retentionExpired') === true
        )
          return false;
        const keys = Object.keys(
          removeUndefinedValues(updates as Record<string, unknown>),
        );
        const delivered =
          doc.get('status') === 'delivered' ||
          doc.get('shipmentStatus') === 'delivered';
        const confirmation =
          updates.buyerConfirmedReceived === true &&
          updates.buyerConfirmedReceivedAt instanceof Date &&
          updates.status === 'delivered' &&
          !doc.get('buyerConfirmedReceived') &&
          keys.every((key) =>
            [
              'buyerConfirmedReceived',
              'buyerConfirmedReceivedAt',
              'status',
            ].includes(key),
          );
        const dispute =
          updates.buyerDisputeStatus === 'under_review' &&
          updates.buyerDisputedAt instanceof Date &&
          [
            'wrong_item',
            'item_not_as_described',
            'item_arrived_damaged',
            'something_else',
          ].includes(updates.buyerDisputeReason || '') &&
          (updates.buyerDisputeMessage === undefined ||
            (typeof updates.buyerDisputeMessage === 'string' &&
              updates.buyerDisputeMessage.length <= 1000)) &&
          !doc.get('buyerDisputeStatus') &&
          keys.every((key) =>
            [
              'buyerDisputeReason',
              'buyerDisputeStatus',
              'buyerDisputeMessage',
              'buyerDisputedAt',
            ].includes(key),
          );
        if (!delivered || (!confirmation && !dispute)) return false;
      } else if (doc.get('deletionMinimised') === true) {
        // Delayed provider writes cannot restore fields after minimisation.
        return false;
      }
      transaction.update(
        ref,
        removeUndefinedValues(updates as Record<string, unknown>),
      );
      return true;
    });
  }

  async getAllOrders(): Promise<Order[]> {
    const snapshot = await firestore.collection('orders').get();
    return snapshot.docs.map((doc) => this.mapToOrder(doc.id, doc.data()));
  }

  async getOrdersByUserId(userId: string): Promise<Order[]> {
    const snapshot = await firestore
      .collection('orders')
      .where('userId', '==', userId)
      .get();

    const orders = snapshot.docs.map((doc) =>
      this.mapToOrder(doc.id, doc.data()),
    );

    return orders.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  async getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]> {
    const snapshot = await firestore
      .collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => this.mapToOrder(doc.id, doc.data()));
  }

  private mapToOrder(id: string, data: FirebaseFirestore.DocumentData): Order {
    const toDate = (value: unknown): Date | undefined => {
      if (!value) {
        return undefined;
      }

      if (typeof (value as { toDate?: unknown }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate();
      }

      const date = new Date(value as string | number | Date);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };

    return {
      id,
      ...data,
      createdAt: toDate(data.createdAt) ?? new Date(data.createdAt),
      buyerConfirmedReceivedAt: toDate(data.buyerConfirmedReceivedAt),
      sellerSoldEmailSentAt: toDate(data.sellerSoldEmailSentAt),
      buyerShipmentStartedEmailSentAt: toDate(
        data.buyerShipmentStartedEmailSentAt,
      ),
      buyerDeliveryEmailSentAt: toDate(data.buyerDeliveryEmailSentAt),
      buyerDisputedAt: toDate(data.buyerDisputedAt),
    } as Order;
  }
}
