import { isDeepStrictEqual } from 'util';
import {
  ListingSafetyError,
  listingEditVersion,
  hasPendingPayment,
} from '../../../shared/utils/listingSafety';
import { firestore } from '../../../shared/config/firebaseConfig';
import { FieldValue } from 'firebase-admin/firestore';
import { gbpToPence } from '../../../shared/utils/money';
import { FulfillmentJob } from '../model/FulfillmentJob';
import { Order } from '../model/Order';

const PAYMENT_RESERVATION_MS = 15 * 60 * 1000;
const FULFILLMENT_LEASE_MS = 10 * 60 * 1000;

export class PendingOrderUnavailableError extends Error {
  constructor(
    public readonly reason: 'expired' | 'unavailable' | 'not_payable',
  ) {
    super(`Pending order cannot be finalized: ${reason}`);
    this.name = 'PendingOrderUnavailableError';
  }
}

export class FulfillmentJobBusyError extends Error {
  constructor(orderId: string) {
    super(`Fulfillment job for order ${orderId} is already being processed`);
    this.name = 'FulfillmentJobBusyError';
  }
}

export class PaymentOrderMismatchError extends Error {
  constructor() {
    super('Pending order does not match verified payment');
    this.name = 'PaymentOrderMismatchError';
  }
}

const removeUndefinedValues = <T extends Record<string, unknown>>(
  value: T,
): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;

export type CreatePendingOrderInput = Pick<
  Order,
  | 'userId'
  | 'sellerId'
  | 'charityId'
  | 'email'
  | 'productAmount'
  | 'shippingFee'
  | 'securityFee'
  | 'totalAmount'
  | 'currency'
  | 'productId'
  | 'productName'
  | 'deliveryType'
  | 'shippingOptionId'
  | 'shippingOptionName'
  | 'shippingCarrier'
  | 'shippingWeight'
  | 'shipping'
  | 'pickupPoint'
  | 'listingEditVersion'
  | 'stripeCustomerId'
>;

export interface VerifiedOrderPayment {
  userId: string;
  sellerId: string;
  charityId: string;
  productId: string;
  shippingMethodId: string;
  shippingMethodName: string;
  pickupPointId: string;
  destinationCountry: string;
  destinationPostalCode: string;
  shippingCarrier: string;
  shippingWeight: number;
  productAmount: number;
  shippingFee: number;
  securityFee: number;
  totalAmount: number;
  currency: 'GBP';
}

export class OrderRepository {
  createOrderId(): string {
    return firestore.collection('orders').doc().id;
  }

  async createPendingOrder(
    orderId: string,
    input: CreatePendingOrderInput,
    expectedEditVersion?: number,
  ): Promise<Order> {
    const orderRef = firestore.collection('orders').doc(orderId);
    const productRef = firestore.collection('products').doc(input.productId);
    const pendingOrdersQuery = firestore
      .collection('orders')
      .where('productId', '==', input.productId);

    return firestore.runTransaction(async (transaction) => {
      const [orderDoc, pendingOrders, productDoc] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(pendingOrdersQuery),
        transaction.get(productRef),
      ]);

      if (orderDoc.exists) {
        throw new Error('Order already exists');
      }
      if (!productDoc.exists) {
        throw new Error('Product not found');
      }

      const productData = productDoc.data()!;
      const quantity =
        typeof productData.number === 'number' ? productData.number : 0;
      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        (productData.status !== undefined && productData.status !== 'active') ||
        productData.hidden === true ||
        productData.moderationStatus === 'hidden'
      ) {
        throw new Error('Product is not available');
      }

      const deletions = await Promise.all(
        [input.userId, input.sellerId].map((uid) =>
          transaction.get(firestore.collection('account_deletions').doc(uid)),
        ),
      );
      if (deletions.some((doc) => doc.exists))
        throw new ListingSafetyError(
          409,
          'ACCOUNT_DELETION_PENDING',
          'Account deletion is in progress.',
        );

      if (
        typeof productData.price !== 'number' ||
        gbpToPence(productData.price) !== input.productAmount
      ) {
        throw new Error('Product price changed');
      }

      const revision = listingEditVersion(productData);
      if (revision >= Number.MAX_SAFE_INTEGER)
        throw new ListingSafetyError(
          409,
          'LISTING_NOT_AVAILABLE',
          'This listing needs review before checkout.',
        );
      if (
        input.listingEditVersion !== revision ||
        (expectedEditVersion !== undefined && expectedEditVersion !== revision)
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_CONFLICT',
          'This listing changed. Reopen it before paying.',
        );
      }
      if (
        expectedEditVersion === undefined &&
        productData.hasBeenEdited === true
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_REQUIRED',
          'Reopen this edited listing before paying.',
        );
      }
      if (
        productData.userId === input.userId ||
        productData.userId !== input.sellerId ||
        productData.charityId !== input.charityId
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_NOT_AVAILABLE',
          'This listing is not available for this checkout.',
        );
      }
      // A deadline cannot prove that Stripe has cancelled an actionable intent.
      // Keep uncertain creation and processing attempts reserved until reconciled.
      const activeOrders = pendingOrders.docs.filter((doc) => {
        const data = doc.data();
        return hasPendingPayment(data);
      });
      for (const pending of activeOrders) {
        const existing = pending.data();
        const sameSelection = Object.entries(input).every(
          ([key, value]) =>
            key === 'stripeCustomerId' ||
            isDeepStrictEqual(existing[key], value),
        );
        if (
          sameSelection &&
          existing.userId === input.userId &&
          existing.stripeCustomerId
        ) {
          return this.mapToOrder(pending.id, existing);
        }
      }
      if (activeOrders.length > 0) {
        throw new ListingSafetyError(
          409,
          'LISTING_PAYMENT_PENDING',
          'A payment is already in progress for this listing.',
        );
      }

      const now = new Date();
      const paymentExpiresAt = new Date(now.getTime() + PAYMENT_RESERVATION_MS);
      const orderData = removeUndefinedValues({
        ...input,
        paymentStatus: 'pending' as const,
        status: 'pending_payment' as const,
        shipmentStatus: 'pending' as const,
        paymentExpiresAt,
        reservationActive: true,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(orderRef, orderData);
      transaction.update(productRef, {
        checkoutReservationVersion: FieldValue.increment(1),
      });

      return {
        id: orderRef.id,
        ...orderData,
      } as Order;
    });
  }

  async getPendingOrdersForProduct(productId: string): Promise<Order[]> {
    const snapshot = await firestore
      .collection('orders')
      .where('productId', '==', productId)
      .get();
    return snapshot.docs
      .filter((doc) => hasPendingPayment(doc.data()))
      .map((doc) => this.mapToOrder(doc.id, doc.data()));
  }

  async attachPaymentIntent(
    orderId: string,
    paymentIntentId: string,
  ): Promise<void> {
    const orderRef = firestore.collection('orders').doc(orderId);
    await firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error('Pending order not found');
      }

      const orderData = orderDoc.data()!;
      if (
        orderData.paymentIntentId &&
        orderData.paymentIntentId !== paymentIntentId
      ) {
        throw new Error('Pending order is already linked to another payment');
      }
      if (
        orderData.status !== 'pending_payment' &&
        orderData.paymentIntentId !== paymentIntentId
      ) {
        throw new Error('Pending order is no longer payable');
      }

      transaction.update(orderRef, {
        paymentIntentId,
        updatedAt: new Date(),
      });
    });
  }

  async releasePendingOrder(
    orderId: string,
    paymentIntentId: string,
    cancelled = true,
  ): Promise<void> {
    const orderRef = firestore.collection('orders').doc(orderId);
    await firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error('Pending order not found');
      }
      const orderData = orderDoc.data()!;
      if (!cancelled)
        throw new Error(
          'Only confirmed Stripe cancellation can release a pending order',
        );
      if (orderData.paymentIntentId !== paymentIntentId) {
        throw new Error('PaymentIntent does not match pending order');
      }
      if (orderData.status !== 'pending_payment') return;
      const productRef = firestore
        .collection('products')
        .doc(orderData.productId);
      const productDoc = await transaction.get(productRef);

      transaction.update(orderRef, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        reservationActive: false,
        updatedAt: new Date(),
      });
      if (productDoc.exists) {
        transaction.update(productRef, {
          checkoutReservationVersion: FieldValue.increment(1),
        });
      }
    });
  }

  async finalizePendingOrder(
    orderId: string,
    paymentIntentId: string,
    payment: VerifiedOrderPayment,
  ): Promise<Order> {
    const orderRef = firestore.collection('orders').doc(orderId);
    const fulfillmentJobRef = firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId);
    const paymentLockRef = firestore
      .collection('order_payment_intents')
      .doc(paymentIntentId);

    const result = await firestore.runTransaction(async (transaction) => {
      const [orderDoc, paymentLock, fulfillmentJobDoc] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(paymentLockRef),
        transaction.get(fulfillmentJobRef),
      ]);

      if (!orderDoc.exists) {
        throw new Error('Pending order not found');
      }

      const orderData = orderDoc.data()!;
      if (orderData.userId !== payment.userId) {
        throw new Error('Order does not belong to the authenticated user');
      }
      if (paymentLock.exists && paymentLock.data()!.orderId === orderId) {
        if (orderData.paymentIntentId !== paymentIntentId) {
          throw new Error('Order is linked to a different payment');
        }
        if (!this.orderMatchesPayment(orderData, payment)) {
          throw new Error('Paid order does not match verified payment');
        }
        if (!fulfillmentJobDoc.exists) {
          transaction.create(
            fulfillmentJobRef,
            this.createFulfillmentJobData(orderId, new Date(), orderData),
          );
        }
        return this.mapToOrder(orderId, orderData);
      }
      if (paymentLock.exists) {
        throw new Error('PaymentIntent has already been used');
      }
      if (
        orderData.paymentIntentId &&
        orderData.paymentIntentId !== paymentIntentId
      ) {
        throw new Error('PaymentIntent does not match pending order');
      }
      if (orderData.status !== 'pending_payment') {
        if (['expired', 'failed', 'cancelled'].includes(orderData.status)) {
          throw new PendingOrderUnavailableError('not_payable');
        }
        throw new Error('Pending order is no longer payable');
      }
      if (fulfillmentJobDoc.exists) {
        throw new Error('Fulfillment job already exists for unpaid order');
      }

      const productRef = firestore
        .collection('products')
        .doc(orderData.productId);
      const productDoc = await transaction.get(productRef);
      if (!this.orderMatchesPayment(orderData, payment)) {
        const now = new Date();
        transaction.update(orderRef, {
          paymentIntentId,
          status: 'failed',
          paymentStatus: 'failed',
          reservationActive: false,
          updatedAt: now,
        });
        if (productDoc.exists) {
          transaction.update(productRef, {
            checkoutReservationVersion: FieldValue.increment(1),
          });
        }
        return 'mismatch' as const;
      }
      if (!productDoc.exists || orderData.reservationActive !== true) {
        transaction.update(orderRef, {
          paymentIntentId,
          status: 'failed',
          paymentStatus: 'failed',
          reservationActive: false,
          updatedAt: new Date(),
        });
        return 'unavailable' as const;
      }

      const productData = productDoc.data()!;
      const quantity =
        typeof productData.number === 'number' ? productData.number : 0;
      if (quantity <= 0) {
        transaction.update(orderRef, {
          paymentIntentId,
          status: 'failed',
          paymentStatus: 'failed',
          reservationActive: false,
          updatedAt: new Date(),
        });
        transaction.update(productRef, {
          checkoutReservationVersion: FieldValue.increment(1),
        });
        return 'unavailable' as const;
      }

      const now = new Date();
      transaction.update(orderRef, {
        paymentIntentId,
        paymentStatus: 'succeeded',
        status: 'paid',
        reservationActive: false,
        paidAt: now,
        updatedAt: now,
      });
      transaction.update(productRef, {
        hasSales: true,
        editVersion: listingEditVersion(productData) + 1,
        number: quantity - 1,
        status:
          quantity - 1 <= 0
            ? 'sold'
            : typeof productData.status === 'string'
              ? productData.status
              : 'active',
        checkoutReservationVersion: FieldValue.increment(1),
        updatedAt: now,
      });
      transaction.set(paymentLockRef, {
        orderId,
        userId: payment.userId,
        createdAt: now,
      });
      transaction.create(
        fulfillmentJobRef,
        this.createFulfillmentJobData(orderId, now),
      );

      return {
        id: orderId,
        ...orderData,
        paymentIntentId,
        paymentStatus: 'succeeded',
        status: 'paid',
        reservationActive: false,
        paidAt: now,
        updatedAt: now,
      } as Order;
    });

    if (result === 'unavailable') {
      throw new PendingOrderUnavailableError('unavailable');
    }
    if (result === 'mismatch') {
      throw new PaymentOrderMismatchError();
    }
    return result;
  }

  async markPaymentRefunded(
    orderId: string,
    paymentIntentId: string,
  ): Promise<void> {
    const orderRef = firestore.collection('orders').doc(orderId);
    await firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error('Order not found while recording refund');
      }

      const orderData = orderDoc.data()!;
      if (orderData.paymentIntentId !== paymentIntentId) {
        throw new Error('Refund does not match order payment');
      }
      if (orderData.paymentStatus === 'refunded') {
        return;
      }
      if (!['expired', 'failed', 'cancelled'].includes(orderData.status)) {
        throw new Error('Only unavailable orders can be marked refunded');
      }

      transaction.update(orderRef, {
        paymentStatus: 'refunded',
        refundedAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }

  private orderMatchesPayment(
    order: Record<string, any>,
    payment: VerifiedOrderPayment,
  ): boolean {
    return (
      order.sellerId === payment.sellerId &&
      order.charityId === payment.charityId &&
      order.productId === payment.productId &&
      order.productAmount === payment.productAmount &&
      order.shippingFee === payment.shippingFee &&
      order.securityFee === payment.securityFee &&
      order.totalAmount === payment.totalAmount &&
      order.currency === payment.currency &&
      order.shippingOptionId === payment.shippingMethodId &&
      order.shippingOptionName === payment.shippingMethodName &&
      order.shippingWeight === payment.shippingWeight &&
      order.shippingCarrier === payment.shippingCarrier &&
      order.pickupPoint?.id === payment.pickupPointId &&
      String(order.shipping?.address?.country ?? '').toUpperCase() ===
        payment.destinationCountry.toUpperCase() &&
      this.normalizePostalCode(order.shipping?.address?.postal_code ?? '') ===
        this.normalizePostalCode(payment.destinationPostalCode)
    );
  }

  private normalizePostalCode(postalCode: string): string {
    return postalCode.replace(/\s/g, '').toUpperCase();
  }

  async getFulfillmentJob(orderId: string): Promise<FulfillmentJob | null> {
    const jobDoc = await firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId)
      .get();
    if (!jobDoc.exists) {
      return null;
    }
    return {
      orderId,
      ...jobDoc.data(),
    } as FulfillmentJob;
  }

  async claimFulfillmentJob(orderId: string): Promise<'claimed' | 'completed'> {
    const jobRef = firestore.collection('order_fulfillment_jobs').doc(orderId);
    return firestore.runTransaction(async (transaction) => {
      const jobDoc = await transaction.get(jobRef);
      if (!jobDoc.exists) {
        throw new Error(`Fulfillment job for order ${orderId} was not found`);
      }

      const job = jobDoc.data()!;
      if (job.status === 'completed') {
        return 'completed';
      }

      const now = new Date();
      const leaseUntil = this.toDate(job.leaseUntil);
      if (job.status === 'processing' && leaseUntil && leaseUntil > now) {
        throw new FulfillmentJobBusyError(orderId);
      }

      transaction.update(jobRef, {
        status: 'processing',
        attempts: (typeof job.attempts === 'number' ? job.attempts : 0) + 1,
        leaseUntil: new Date(now.getTime() + FULFILLMENT_LEASE_MS),
        updatedAt: now,
      });
      return 'claimed';
    });
  }

  async updateFulfillmentJob(
    orderId: string,
    updates: Partial<FulfillmentJob>,
  ): Promise<void> {
    await firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId)
      .update({
        ...updates,
        updatedAt: new Date(),
      });
  }

  async retryFulfillmentJob(orderId: string, error: unknown): Promise<void> {
    await firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId)
      .update({
        status: 'pending',
        leaseUntil: FieldValue.delete(),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      });
  }

  async completeFulfillmentJob(orderId: string): Promise<void> {
    await firestore.collection('order_fulfillment_jobs').doc(orderId).update({
      status: 'completed',
      leaseUntil: FieldValue.delete(),
      lastError: null,
      updatedAt: new Date(),
    });
  }

  async getOrderById(id: string): Promise<Order | null> {
    const doc = await firestore.collection('orders').doc(id).get();
    if (!doc.exists) {
      return null;
    }
    return this.mapToOrder(doc.id, doc.data()!);
  }

  async updateOrder(id: string, updates: Partial<Order>): Promise<void> {
    await firestore
      .collection('orders')
      .doc(id)
      .update(removeUndefinedValues(updates as Record<string, unknown>));
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

  private createFulfillmentJobData(
    orderId: string,
    now = new Date(),
    orderData?: FirebaseFirestore.DocumentData,
  ) {
    return {
      orderId,
      status: 'pending' as const,
      attempts: 0,
      shipmentCompleted: Boolean(orderData?.shipmentId),
      sellerNotificationCompleted: Boolean(orderData?.sellerSoldEmailSentAt),
      buyerNotificationCompleted: Boolean(
        orderData?.buyerShipmentStartedEmailSentAt,
      ),
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mapToOrder(id: string, data: FirebaseFirestore.DocumentData): Order {
    return {
      id,
      ...data,
      createdAt: this.toDate(data.createdAt) ?? new Date(data.createdAt),
      paymentExpiresAt: this.toDate(data.paymentExpiresAt),
      paidAt: this.toDate(data.paidAt),
      buyerConfirmedReceivedAt: this.toDate(data.buyerConfirmedReceivedAt),
      sellerSoldEmailSentAt: this.toDate(data.sellerSoldEmailSentAt),
      buyerShipmentStartedEmailSentAt: this.toDate(
        data.buyerShipmentStartedEmailSentAt,
      ),
      buyerDeliveryEmailSentAt: this.toDate(data.buyerDeliveryEmailSentAt),
      buyerDisputedAt: this.toDate(data.buyerDisputedAt),
    } as Order;
  }

  private toDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }

    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }

    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
