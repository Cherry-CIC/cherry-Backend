import { firestore } from '../../../shared/config/firebaseConfig';
import { Order } from '../model/Order';

/** Options passed to {@link OrderRepository.createOrder}. */
export interface CreateOrderOptions {
  userId: string;
  email: string;
  amount: number;
  productId?: string;
  productName?: string;
  shipping?: any;
  deliveryMethod?: 'ship_to_home' | 'pickup_point';
  shippingProvider?: 'sendcloud';
  courier?: string;
  pickupPointId?: string;
}

/**
 * Repository handling persistence of orders in Firestore.
 */
export class OrderRepository {
  /**
   * Retrieves a single order by Firestore document ID.
   *
   * @param orderId - Firestore document ID of the order.
   * @returns The order or null when not found.
   */
  async getById(orderId: string): Promise<Order | null> {
    const doc = await firestore.collection('orders').doc(orderId).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as Omit<Order, 'id'>;
    return { id: doc.id, ...data };
  }

  /**
   * Saves a new order document.
   *
   * @param opts - Order creation options (see {@link CreateOrderOptions}).
   * @returns The saved Order, including its generated Firestore ID.
   */
  async createOrder(opts: CreateOrderOptions): Promise<Order> {
    const {
      userId,
      email,
      amount,
      productId,
      productName,
      shipping,
      deliveryMethod,
      shippingProvider,
      courier,
      pickupPointId,
    } = opts;

    const now = new Date();

    // Build the Firestore document – only include defined optional fields
    const docPayload: Record<string, any> = {
      userId,
      email,
      amount,
      createdAt: now,
    };
    if (productId !== undefined) docPayload.productId = productId;
    if (productName !== undefined) docPayload.productName = productName;
    if (shipping !== undefined) docPayload.shipping = shipping;
    if (deliveryMethod !== undefined)
      docPayload.deliveryMethod = deliveryMethod;
    if (shippingProvider !== undefined)
      docPayload.shippingProvider = shippingProvider;
    if (courier !== undefined) docPayload.courier = courier;
    if (pickupPointId !== undefined) docPayload.pickupPointId = pickupPointId;

    const docRef = await firestore.collection('orders').add(docPayload);

    return {
      id: docRef.id,
      userId,
      email,
      amount,
      productId,
      productName,
      shipping,
      deliveryMethod,
      shippingProvider,
      courier,
      pickupPointId,
      createdAt: now,
    };
  }

  /**
   * Updates an order's tracking number and optional shipment reference after
   * a Sendcloud parcel has been successfully created.
   *
   * @param orderId        - Firestore document ID of the order.
   * @param trackingNumber - Sendcloud tracking number string.
   * @param shipmentId     - Internal shipment document ID (optional).
   */
  async updateOrderTracking(
    orderId: string,
    trackingNumber: string,
    shipmentId?: string,
  ): Promise<void> {
    const updates: Record<string, any> = { trackingNumber };
    if (shipmentId !== undefined) updates.shipmentId = shipmentId;
    await firestore.collection('orders').doc(orderId).update(updates);
  }

  /**
   * Retrieves all orders from Firestore.
   */
  async getAllOrders(): Promise<Order[]> {
    const snapshot = await firestore.collection('orders').get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<Order, 'id'>;
      return { id: doc.id, ...data };
    });
  }

  /**
   * Retrieves orders within a specific date range from Firestore.
   *
   * @param startDate - Start date of the range (inclusive)
   * @param endDate   - End date of the range (inclusive)
   * @returns Array of orders within the date range
   */
  async getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]> {
    const snapshot = await firestore
      .collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      // Handle Firestore Timestamp conversion
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
        deliveryMethod: data.deliveryMethod,
        shippingProvider: data.shippingProvider,
        courier: data.courier,
        pickupPointId: data.pickupPointId,
        trackingNumber: data.trackingNumber,
        status: data.status || 'completed',
        createdAt,
      } as Order;
    });
  }
}
