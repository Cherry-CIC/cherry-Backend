import { firestore } from '../../../shared/config/firebaseConfig';
import { gbpToPence } from '../../../shared/utils/money';
import { Order } from '../model/Order';

const removeUndefinedValues = <T extends Record<string, unknown>>(
  value: T,
): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;

export interface CreateOrderInput {
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
        typeof productData.price !== 'number' ||
        gbpToPence(productData.price) !== input.productAmount
      ) {
        throw new Error('Product price changed');
      }

      const orderData = this.buildOrderData(input);
      transaction.set(orderRef, {
        ...orderData,
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
