import { firestore } from '../../../shared/config/firebaseConfig';
import { Order } from '../model/Order';

/** Options passed to {@link OrderRepository.createOrder}. */
export interface CreateOrderOptions {
  userId: string;
  email: string;
  amount: number;
  currency?: 'gbp';
  paymentIntentId?: string;
  paymentStatus?: string;
  productId?: string;
  productName?: string;
  productSnapshot?: Order['productSnapshot'];
  shipping?: any;
  deliveryType?: 'home' | 'pickup_point';
  deliveryMethod?: 'ship_to_home' | 'pickup_point';
  shippingProvider?: 'sendcloud';
  shippingOptionId?: string;
  shippingOptionName?: string;
  shippingOptionPrice?: number;
  shippingCarrier?: string;
  shippingWeight?: number;
  courier?: string;
  pickupPointId?: string;
  pickupPoint?: Order['pickupPoint'];
  status?: Order['status'];
  shipmentStatus?: Order['shipmentStatus'];
}

export interface CreateOrderResult {
  order: Order;
  created: boolean;
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

    return this.mapToOrder(doc.id, doc.data());
  }

  async getByPaymentIntentId(paymentIntentId: string): Promise<Order | null> {
    const idempotencyDoc = await firestore
      .collection('orderPaymentIntents')
      .doc(paymentIntentId)
      .get();

    if (idempotencyDoc.exists) {
      const orderId = idempotencyDoc.data()?.orderId;
      return orderId ? this.getById(orderId) : null;
    }

    const snapshot = await firestore
      .collection('orders')
      .where('paymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return this.mapToOrder(doc.id, doc.data());
  }

  /**
   * Saves a new order document.
   *
   * @param opts - Order creation options (see {@link CreateOrderOptions}).
   * @returns The saved Order, including its generated Firestore ID.
   */
  async createOrder(opts: CreateOrderOptions): Promise<Order> {
    const docPayload = this.buildOrderPayload(opts);
    const docRef = await firestore.collection('orders').add(docPayload);

    return this.mapToOrder(docRef.id, docPayload);
  }

  /**
   * Creates an order once for a Stripe PaymentIntent.
   *
   * Frontend retries may resend the same paymentIntentId after a successful
   * PaymentSheet flow. This transaction keeps the order idempotent without
   * relying on a non-unique Firestore query.
   */
  async createOrderIdempotently(
    opts: CreateOrderOptions & { paymentIntentId: string },
  ): Promise<CreateOrderResult> {
    return firestore.runTransaction(async (transaction) => {
      const idempotencyRef = firestore
        .collection('orderPaymentIntents')
        .doc(opts.paymentIntentId);
      const idempotencyDoc = await transaction.get(idempotencyRef);

      if (idempotencyDoc.exists) {
        const orderId = idempotencyDoc.data()?.orderId;
        if (!orderId) {
          throw new Error('Order idempotency record is missing orderId');
        }

        const existingOrderRef = firestore.collection('orders').doc(orderId);
        const existingOrderDoc = await transaction.get(existingOrderRef);
        if (!existingOrderDoc.exists) {
          throw new Error('Order idempotency record points to a missing order');
        }

        return {
          order: this.mapToOrder(existingOrderDoc.id, existingOrderDoc.data()),
          created: false,
        };
      }

      const docPayload = this.buildOrderPayload(opts);
      const orderRef = firestore.collection('orders').doc();

      transaction.set(orderRef, docPayload);
      transaction.set(idempotencyRef, {
        orderId: orderRef.id,
        paymentIntentId: opts.paymentIntentId,
        userId: opts.userId,
        createdAt: docPayload.createdAt,
      });

      return {
        order: this.mapToOrder(orderRef.id, docPayload),
        created: true,
      };
    });
  }

  private buildOrderPayload(opts: CreateOrderOptions): Record<string, any> {
    const {
      userId,
      email,
      amount,
      currency,
      paymentIntentId,
      paymentStatus,
      productId,
      productName,
      productSnapshot,
      shipping,
      deliveryType,
      deliveryMethod,
      shippingProvider,
      shippingOptionId,
      shippingOptionName,
      shippingOptionPrice,
      shippingCarrier,
      shippingWeight,
      courier,
      pickupPointId,
      pickupPoint,
      status,
      shipmentStatus,
    } = opts;

    const now = new Date();

    // Build the Firestore document – only include defined optional fields
    const docPayload: Record<string, any> = {
      userId,
      email,
      amount,
      createdAt: now,
    };
    if (currency !== undefined) docPayload.currency = currency;
    if (paymentIntentId !== undefined)
      docPayload.paymentIntentId = paymentIntentId;
    if (paymentStatus !== undefined) docPayload.paymentStatus = paymentStatus;
    if (productId !== undefined) docPayload.productId = productId;
    if (productName !== undefined) docPayload.productName = productName;
    if (productSnapshot !== undefined)
      docPayload.productSnapshot = productSnapshot;
    if (shipping !== undefined) docPayload.shipping = shipping;
    if (deliveryType !== undefined) docPayload.deliveryType = deliveryType;
    if (deliveryMethod !== undefined)
      docPayload.deliveryMethod = deliveryMethod;
    if (shippingProvider !== undefined)
      docPayload.shippingProvider = shippingProvider;
    if (shippingOptionId !== undefined)
      docPayload.shippingOptionId = shippingOptionId;
    if (shippingOptionName !== undefined)
      docPayload.shippingOptionName = shippingOptionName;
    if (shippingOptionPrice !== undefined)
      docPayload.shippingOptionPrice = shippingOptionPrice;
    if (shippingCarrier !== undefined)
      docPayload.shippingCarrier = shippingCarrier;
    if (shippingWeight !== undefined)
      docPayload.shippingWeight = shippingWeight;
    if (courier !== undefined) docPayload.courier = courier;
    if (pickupPointId !== undefined) docPayload.pickupPointId = pickupPointId;
    if (pickupPoint !== undefined) docPayload.pickupPoint = pickupPoint;
    if (status !== undefined) docPayload.status = status;
    if (shipmentStatus !== undefined)
      docPayload.shipmentStatus = shipmentStatus;

    return docPayload;
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
    const updates: Record<string, any> = {
      trackingNumber,
      shipmentStatus: 'announced',
    };
    if (shipmentId !== undefined) updates.shipmentId = shipmentId;
    await firestore.collection('orders').doc(orderId).update(updates);
  }

  async updateOrderShipmentStatus(
    orderId: string,
    shipmentStatus: Order['shipmentStatus'],
    shipmentId?: string,
  ): Promise<void> {
    const updates: Record<string, any> = { shipmentStatus };
    if (shipmentId !== undefined) updates.shipmentId = shipmentId;
    await firestore.collection('orders').doc(orderId).update(updates);
  }

  async updatePaymentStatusByPaymentIntentId(
    paymentIntentId: string,
    paymentStatus: string,
  ): Promise<void> {
    const snapshot = await firestore
      .collection('orders')
      .where('paymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      await firestore
        .collection('stripePaymentIntents')
        .doc(paymentIntentId)
        .set(
          {
            paymentIntentId,
            paymentStatus,
            updatedAt: new Date(),
          },
          { merge: true },
        );
      return;
    }

    await snapshot.docs[0].ref.update({
      paymentStatus,
      updatedAt: new Date(),
    });
  }

  /**
   * Retrieves all orders from Firestore.
   */
  async getAllOrders(): Promise<Order[]> {
    const snapshot = await firestore.collection('orders').get();
    return snapshot.docs.map((doc) => {
      return this.mapToOrder(doc.id, doc.data());
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
        currency: data.currency,
        paymentIntentId: data.paymentIntentId,
        paymentStatus: data.paymentStatus,
        productId: data.productId,
        productName: data.productName,
        productSnapshot: data.productSnapshot,
        shipping: data.shipping,
        deliveryType: data.deliveryType,
        deliveryMethod: data.deliveryMethod,
        shippingProvider: data.shippingProvider,
        shippingOptionId: data.shippingOptionId,
        shippingOptionName: data.shippingOptionName,
        shippingOptionPrice: data.shippingOptionPrice,
        shippingCarrier: data.shippingCarrier,
        shippingWeight: data.shippingWeight,
        courier: data.courier,
        pickupPointId: data.pickupPointId,
        pickupPoint: data.pickupPoint,
        trackingNumber: data.trackingNumber,
        status: data.status || 'completed',
        shipmentStatus: data.shipmentStatus,
        createdAt,
      } as Order;
    });
  }

  private mapToOrder(id: string, data: any): Order {
    let createdAt = data.createdAt;
    if (createdAt && typeof createdAt.toDate === 'function') {
      createdAt = createdAt.toDate();
    } else if (createdAt) {
      createdAt = new Date(createdAt);
    }

    return {
      id,
      userId: data.userId || '',
      email: data.email,
      amount: data.amount || 0,
      currency: data.currency,
      paymentIntentId: data.paymentIntentId,
      paymentStatus: data.paymentStatus,
      productId: data.productId,
      productName: data.productName,
      productSnapshot: data.productSnapshot,
      shipping: data.shipping,
      deliveryType: data.deliveryType,
      deliveryMethod: data.deliveryMethod,
      shippingProvider: data.shippingProvider,
      shippingOptionId: data.shippingOptionId,
      shippingOptionName: data.shippingOptionName,
      shippingOptionPrice: data.shippingOptionPrice,
      shippingCarrier: data.shippingCarrier,
      shippingWeight: data.shippingWeight,
      courier: data.courier,
      pickupPointId: data.pickupPointId,
      pickupPoint: data.pickupPoint,
      trackingNumber: data.trackingNumber,
      status: data.status,
      shipmentStatus: data.shipmentStatus,
      shipmentId: data.shipmentId,
      createdAt,
    } as Order;
  }
}
