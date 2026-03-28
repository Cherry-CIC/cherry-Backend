import { firestore } from '../../../shared/config/firebaseConfig';
import { Order } from '../model/Order';

export interface CreateOrderInput {
  userId: string;
  email: string;
  amount: number;
  productId?: string;
  productName?: string;
  deliveryType: Order['deliveryType'];
  shippingOptionId: string;
  shippingOptionName?: string;
  shippingOptionPrice?: string;
  shippingCarrier?: string;
  shippingWeight: number;
  shipping: Order['shipping'];
  pickupPoint?: Order['pickupPoint'];
  paymentIntentId?: string;
  paymentStatus: Order['paymentStatus'];
  shipmentStatus: Order['shipmentStatus'];
  status?: Order['status'];
  shipmentId?: string;
}

export class OrderRepository {
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const orderData: Partial<Order> = {
      userId: input.userId,
      amount: input.amount,
      productId: input.productId,
      productName: input.productName,
      deliveryType: input.deliveryType,
      shippingOptionId: input.shippingOptionId,
      shippingOptionName: input.shippingOptionName,
      shippingOptionPrice: input.shippingOptionPrice,
      shippingCarrier: input.shippingCarrier,
      shippingWeight: input.shippingWeight,
      shipping: input.shipping,
      pickupPoint: input.pickupPoint,
      paymentIntentId: input.paymentIntentId,
      paymentStatus: input.paymentStatus,
      shipmentStatus: input.shipmentStatus,
      status: input.status ?? 'completed',
      shipmentId: input.shipmentId,
      createdAt: new Date(),
    };

    const docRef = await firestore.collection('orders').add({
      ...orderData,
      email: input.email,
    });

    return {
      id: docRef.id,
      userId: input.userId,
      email: input.email,
      amount: input.amount,
      productId: input.productId,
      productName: input.productName,
      deliveryType: input.deliveryType,
      shippingOptionId: input.shippingOptionId,
      shippingOptionName: input.shippingOptionName,
      shippingOptionPrice: input.shippingOptionPrice,
      shippingCarrier: input.shippingCarrier,
      shippingWeight: input.shippingWeight,
      shipping: input.shipping,
      pickupPoint: input.pickupPoint,
      paymentIntentId: input.paymentIntentId,
      paymentStatus: input.paymentStatus,
      shipmentStatus: input.shipmentStatus,
      status: input.status ?? 'completed',
      shipmentId: input.shipmentId,
      createdAt: orderData.createdAt!,
    };
  }

  async getOrderById(id: string): Promise<Order | null> {
    const doc = await firestore.collection('orders').doc(id).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as Omit<Order, 'id'>;
    return { id: doc.id, ...data };
  }

  async updateOrder(id: string, updates: Partial<Order>): Promise<void> {
    await firestore.collection('orders').doc(id).update(updates);
  }

  async getAllOrders(): Promise<Order[]> {
    const snapshot = await firestore.collection('orders').get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<Order, 'id'>;
      return { id: doc.id, ...data };
    });
  }

  async getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]> {
    const snapshot = await firestore
      .collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      let createdAt = data.createdAt;
      if (createdAt && typeof createdAt.toDate === 'function') {
        createdAt = createdAt.toDate();
      } else if (createdAt) {
        createdAt = new Date(createdAt);
      }

      return {
        id: doc.id,
        userId: data.userId || '',
        email: data.email || '',
        amount: data.amount || 0,
        productId: data.productId,
        productName: data.productName,
        shipping: data.shipping,
        deliveryType: data.deliveryType || 'home',
        shippingOptionId: data.shippingOptionId || '',
        shippingOptionName: data.shippingOptionName,
        shippingOptionPrice: data.shippingOptionPrice,
        shippingCarrier: data.shippingCarrier,
        shippingWeight: data.shippingWeight || 0,
        pickupPoint: data.pickupPoint,
        paymentIntentId: data.paymentIntentId,
        paymentStatus: data.paymentStatus || 'pending',
        shipmentStatus: data.shipmentStatus || 'not_created',
        status: data.status || 'completed',
        shipmentId: data.shipmentId,
        createdAt,
      } as Order;
    });
  }
}
