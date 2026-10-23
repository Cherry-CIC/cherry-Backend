import { firestore } from '../../../shared/config/firebaseConfig';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { gbpToPence } from '../../../shared/utils/money';
import { FulfillmentJob } from '../model/FulfillmentJob';
import { Order, PayoutHoldReason, PayoutReleaseTrigger } from '../model/Order';
import {
  evaluatePayoutRelease,
  PayoutReleaseResult,
} from '../services/payoutRelease';
import { calculateReleaseAt } from '../../../shared/config/orderReleaseConfig';
import {
  addHoldReason,
  getActiveHoldReasons,
  holdReasonFields,
  removeHoldReason,
} from '../services/holdReasons';
import {
  PayoutEvent,
  PayoutEventActorRole,
  recordPayoutEvent,
} from '../services/payoutEvents';

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
  ): Promise<Order> {
    const orderRef = firestore.collection('orders').doc(orderId);
    const productRef = firestore.collection('products').doc(input.productId);
    const pendingOrdersQuery = firestore
      .collection('orders')
      .where('productId', '==', input.productId)
      .where('status', '==', 'pending_payment');

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
      if (quantity <= 0 || productData.status !== 'active') {
        throw new Error('Product is not available');
      }

      if (
        typeof productData.price !== 'number' ||
        gbpToPence(productData.price) !== input.productAmount
      ) {
        throw new Error('Product price changed');
      }

      const now = new Date();
      let activeReservations = 0;
      pendingOrders.docs.forEach((pendingOrder) => {
        const pendingData = pendingOrder.data();
        const expiresAt = this.toDate(pendingData.paymentExpiresAt);
        if (expiresAt && expiresAt.getTime() > now.getTime()) {
          activeReservations += 1;
        } else {
          transaction.update(pendingOrder.ref, {
            status: 'expired',
            reservationActive: false,
            updatedAt: now,
          });
        }
      });

      if (quantity - activeReservations <= 0) {
        throw new Error('Product is out of stock');
      }

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
    paymentIntentId?: string,
    cancelled = false,
  ): Promise<void> {
    const orderRef = firestore.collection('orders').doc(orderId);
    await firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error('Pending order not found');
      }
      if (orderDoc.data()!.status !== 'pending_payment') {
        return;
      }

      const orderData = orderDoc.data()!;
      if (
        paymentIntentId &&
        orderData.paymentIntentId !== paymentIntentId
      ) {
        throw new Error('PaymentIntent does not match pending order');
      }
      const productRef = firestore
        .collection('products')
        .doc(orderData.productId);
      const productDoc = await transaction.get(productRef);

      transaction.update(orderRef, {
        status: cancelled ? 'cancelled' : 'failed',
        paymentStatus: cancelled ? 'cancelled' : 'failed',
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
      const paymentExpiresAt = this.toDate(orderData.paymentExpiresAt);
      if (!paymentExpiresAt || paymentExpiresAt.getTime() <= Date.now()) {
        transaction.update(orderRef, {
          paymentIntentId,
          status: 'expired',
          reservationActive: false,
          updatedAt: new Date(),
        });
        if (productDoc.exists) {
          transaction.update(productRef, {
            checkoutReservationVersion: FieldValue.increment(1),
          });
        }
        return 'expired' as const;
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
        payoutStatus: 'held',
        reservationActive: false,
        paidAt: now,
        updatedAt: now,
      });
      transaction.update(productRef, {
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
        payoutStatus: 'held',
        reservationActive: false,
        paidAt: now,
        updatedAt: now,
      } as Order;
    });

    if (result === 'expired') {
      throw new PendingOrderUnavailableError('expired');
    }
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
    const jobRef = firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId);
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
    await firestore
      .collection('order_fulfillment_jobs')
      .doc(orderId)
      .update({
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

  // Idempotent: only the first delivery report starts the hold, so repeated
  // carrier webhooks cannot extend the dispute window.
  async recordDelivery(
    orderId: string,
    now = new Date(),
  ): Promise<{ releaseAt: Date | null; releaseTaskPending: boolean }> {
    const orderRef = firestore.collection('orders').doc(orderId);

    return firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        return { releaseAt: null, releaseTaskPending: false };
      }

      const orderData = orderDoc.data()!;
      if (orderData.deliveredAt) {
        // A repeat report lets a release task that failed to enqueue be retried.
        return {
          releaseAt: this.toDate(orderData.releaseAt) ?? null,
          releaseTaskPending:
            orderData.payoutStatus === 'held' &&
            !orderData.releaseTaskEnqueuedAt,
        };
      }

      const isHeld =
        orderData.paymentStatus === 'succeeded' &&
        [undefined, 'held'].includes(orderData.payoutStatus);
      const releaseAt = isHeld ? calculateReleaseAt(now) : null;

      transaction.update(orderRef, {
        deliveredAt: now,
        updatedAt: now,
        ...(releaseAt
          ? {
              payoutStatus: 'held',
              releaseAt,
              // A hold placed before delivery (for example a refund) keeps the
              // order out of the reconciliation scan until it is cleared.
              ...(getActiveHoldReasons(orderData).length > 0
                ? {}
                : { autoReleaseAt: releaseAt }),
            }
          : {}),
      });
      if (releaseAt) {
        recordPayoutEvent(
          transaction,
          orderRef,
          {
            type: 'hold_started',
            actorRole: 'system',
            fromStatus: orderData.payoutStatus ?? null,
            toStatus: 'held',
            releaseAt,
          },
          now,
        );
      }
      return { releaseAt, releaseTaskPending: releaseAt !== null };
    });
  }

  async markReleaseTaskEnqueued(orderId: string): Promise<void> {
    await this.updateOrder(orderId, { releaseTaskEnqueuedAt: new Date() });
  }

  // Maps a Stripe PaymentIntent back to the order created for it at checkout.
  async getOrderIdByPaymentIntent(
    paymentIntentId: string,
  ): Promise<string | null> {
    const lock = await firestore
      .collection('order_payment_intents')
      .doc(paymentIntentId)
      .get();
    const orderId = lock.exists ? lock.data()?.orderId : null;
    return typeof orderId === 'string' ? orderId : null;
  }

  // Idempotent. An order that was already released but not yet paid out goes
  // back to held, so the payout step never sees a refunded or disputed order.
  async placePayoutHold(
    orderId: string,
    hold: {
      reason: PayoutHoldReason;
      actorRole: PayoutEventActorRole;
      actorId?: string;
      stripeEventId?: string;
      note?: string;
    },
    now = new Date(),
  ): Promise<'placed' | 'unchanged' | 'not_applicable'> {
    const orderRef = firestore.collection('orders').doc(orderId);

    return firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        return 'not_applicable' as const;
      }

      const orderData = orderDoc.data()!;
      if (!['held', 'ready_for_payout'].includes(orderData.payoutStatus)) {
        return 'not_applicable' as const;
      }
      const active = getActiveHoldReasons(orderData);
      if (orderData.payoutStatus === 'held' && active.includes(hold.reason)) {
        return 'unchanged' as const;
      }

      transaction.update(orderRef, {
        payoutStatus: 'held',
        ...holdReasonFields(addHoldReason(active, hold.reason)),
        autoReleaseAt: FieldValue.delete(),
        readyForPayoutAt: FieldValue.delete(),
        payoutReleaseTrigger: FieldValue.delete(),
        updatedAt: now,
      });
      recordPayoutEvent(
        transaction,
        orderRef,
        {
          type: 'hold_placed',
          actorRole: hold.actorRole,
          actorId: hold.actorId,
          fromStatus: orderData.payoutStatus,
          toStatus: 'held',
          reason: hold.reason,
          stripeEventId: hold.stripeEventId,
          note: hold.note,
        },
        now,
      );
      return 'placed' as const;
    });
  }

  // Only clears the hold it is asked to; it never releases the order itself.
  // Other active holds keep the order out of the reconciliation scan.
  async clearPayoutHold(
    orderId: string,
    clear: {
      reason: PayoutHoldReason;
      actorRole: PayoutEventActorRole;
      actorId?: string;
      stripeEventId?: string;
      note?: string;
    },
    now = new Date(),
  ): Promise<'cleared' | 'unchanged'> {
    const orderRef = firestore.collection('orders').doc(orderId);

    return firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      const orderData = orderDoc.exists ? orderDoc.data()! : undefined;
      const active = orderData ? getActiveHoldReasons(orderData) : [];
      if (
        !orderData ||
        orderData.payoutStatus !== 'held' ||
        !active.includes(clear.reason)
      ) {
        return 'unchanged' as const;
      }

      const remaining = removeHoldReason(active, clear.reason);
      transaction.update(orderRef, {
        ...holdReasonFields(remaining),
        // Back in the reconciliation scan, unless another hold or a buyer
        // dispute is still open.
        ...(remaining.length === 0 &&
        orderData.releaseAt &&
        !(
          orderData.buyerDisputeId &&
          orderData.buyerDisputeStatus !== 'resolved'
        )
          ? { autoReleaseAt: orderData.releaseAt }
          : {}),
        updatedAt: now,
      });
      recordPayoutEvent(
        transaction,
        orderRef,
        {
          type: 'hold_cleared',
          actorRole: clear.actorRole,
          actorId: clear.actorId,
          fromStatus: 'held',
          toStatus: 'held',
          reason: clear.reason,
          stripeEventId: clear.stripeEventId,
          note: clear.note,
        },
        now,
      );
      return 'cleared' as const;
    });
  }

  // Orders the reconciliation run may act on, oldest first: those whose
  // autoReleaseAt has passed ('due') or not yet ('upcoming'). The field is
  // removed while any hold or dispute applies and when the order is released, so
  // blocked orders are never rescanned and cannot crowd out newer overdue ones.
  // The cursor guards against an order that keeps failing.
  async getOrdersByAutoRelease(
    window: 'due' | 'upcoming',
    now: Date,
    limit: number,
    startAfter?: { autoReleaseAt: Date; id: string },
  ): Promise<Order[]> {
    let query = firestore
      .collection('orders')
      .where('autoReleaseAt', window === 'due' ? '<=' : '>', now)
      .orderBy('autoReleaseAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
    if (startAfter) {
      query = query.startAfter(startAfter.autoReleaseAt, startAfter.id);
    }

    const snapshot = await query.limit(limit).get();
    return snapshot.docs.map((doc) => this.mapToOrder(doc.id, doc.data()));
  }

  async getPayoutEvents(orderId: string): Promise<PayoutEvent[]> {
    const snapshot = await firestore
      .collection('orders')
      .doc(orderId)
      .collection('payout_events')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map(
      (doc) =>
        ({
          ...doc.data(),
          eventId: doc.id,
          createdAt: this.toDate(doc.data().createdAt) ?? new Date(0),
          ...(doc.data().releaseAt
            ? { releaseAt: this.toDate(doc.data().releaseAt) }
            : {}),
        }) as PayoutEvent,
    );
  }

  // The single gate from HELD to READY_FOR_PAYOUT. Every trigger runs the same
  // checks inside one transaction, so a dispute or refund hold that lands first
  // always wins over buyer confirmation or the expiry task.
  async releaseOrderForPayout(
    orderId: string,
    trigger: PayoutReleaseTrigger,
    now = new Date(),
    admin?: { adminId: string; note?: string },
  ): Promise<PayoutReleaseResult> {
    const orderRef = firestore.collection('orders').doc(orderId);

    return firestore.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        return { status: 'blocked', reason: 'order_not_found' } as const;
      }

      const orderData = orderDoc.data()!;
      const paymentDoc =
        typeof orderData.paymentIntentId === 'string'
          ? await transaction.get(
              firestore.collection('payments').doc(orderData.paymentIntentId),
            )
          : null;

      const decision = evaluatePayoutRelease({
        order: orderData,
        payment: paymentDoc?.exists ? paymentDoc.data()! : null,
        trigger,
        now,
      });
      if (!decision.canRelease) {
        // Stop reconciliation rescanning an order that is blocked for a
        // reason it cannot wait out; the hold, dispute or admin action that
        // resolves the block puts it back.
        if (
          trigger === 'hold_expired' &&
          orderData.autoReleaseAt &&
          !(
            decision.result.status === 'blocked' &&
            decision.result.reason === 'not_due'
          )
        ) {
          transaction.update(orderRef, { autoReleaseAt: FieldValue.delete() });
        }
        return decision.result;
      }

      transaction.update(orderRef, {
        payoutStatus: 'ready_for_payout',
        readyForPayoutAt: now,
        payoutReleaseTrigger: trigger,
        ...holdReasonFields([]),
        autoReleaseAt: FieldValue.delete(),
        updatedAt: now,
      });
      recordPayoutEvent(
        transaction,
        orderRef,
        {
          type: 'released',
          actorRole: admin
            ? 'admin'
            : trigger === 'buyer_confirmation'
              ? 'buyer'
              : 'system',
          actorId: admin
            ? admin.adminId
            : trigger === 'buyer_confirmation' &&
                typeof orderData.userId === 'string'
              ? orderData.userId
              : undefined,
          fromStatus: 'held',
          toStatus: 'ready_for_payout',
          trigger,
          note: admin?.note,
          reason:
            trigger === 'admin_override'
              ? getActiveHoldReasons(orderData)[0]
              : undefined,
        },
        now,
      );
      return { status: 'released' } as const;
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
      deliveredAt: this.toDate(data.deliveredAt),
      releaseAt: this.toDate(data.releaseAt),
      autoReleaseAt: this.toDate(data.autoReleaseAt),
      releaseTaskEnqueuedAt: this.toDate(data.releaseTaskEnqueuedAt),
      readyForPayoutAt: this.toDate(data.readyForPayoutAt),
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
