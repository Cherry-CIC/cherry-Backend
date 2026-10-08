import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { Order } from '../../order/model/Order';
import { firestore } from '../../../shared/config/firebaseConfig';
import { Shipment } from '../models/Shipment';

/**
 * Repository for handling shipment persistence in Firestore
 */
export class ShipmentRepository {
  private collection = 'shipments';

  /**
   * Create a new shipment in Firestore
   * @param shipmentData - Shipment data without ID
   * @returns Created shipment with generated ID
   */
  async beginShipmentCreation(
    orderId: string,
  ): Promise<{ order: Order; attemptId: string }> {
    const ref = firestore.collection('orders').doc(orderId);
    const attemptId = randomUUID();
    return firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      const existing = await transaction.get(
        firestore
          .collection(this.collection)
          .where('orderId', '==', orderId)
          .limit(1),
      );
      if (
        !doc.exists ||
        doc.get('deletionMinimised') === true ||
        doc.get('retentionExpired') === true ||
        doc.get('status') !== 'paid' ||
        doc.get('paymentStatus') !== 'succeeded'
      ) {
        throw new Error('Order is no longer available for shipment');
      }
      if (!existing.empty || doc.get('shipmentCreationPending') === true) {
        throw new Error('Shipment creation requires reconciliation');
      }
      // The deletion worker must retain this operational order until the provider
      // outcome is durably recorded. Timeouts never prove that no parcel exists.
      transaction.update(ref, {
        shipmentCreationPending: true,
        shipmentCreationAttemptId: attemptId,
        shipmentCreationStartedAt: new Date(),
      });
      return { order: { ...doc.data(), id: orderId } as Order, attemptId };
    });
  }

  async createShipment(
    shipmentData: Omit<Shipment, 'id'>,
    attemptId: string,
  ): Promise<Shipment> {
    const docRef = firestore.collection(this.collection).doc();
    const orderRef = firestore.collection('orders').doc(shipmentData.orderId);
    await firestore.runTransaction(async (transaction) => {
      const order = await transaction.get(orderRef);
      if (
        !order.exists ||
        order.get('deletionMinimised') === true ||
        order.get('retentionExpired') === true ||
        order.get('shipmentCreationPending') !== true ||
        order.get('shipmentCreationAttemptId') !== attemptId
      ) {
        throw new Error('Shipment creation requires reconciliation');
      }
      transaction.create(docRef, {
        ...shipmentData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      transaction.update(orderRef, {
        shipmentId: docRef.id,
        shipmentCreationPending: FieldValue.delete(),
        shipmentCreationAttemptId: FieldValue.delete(),
        shipmentCreationStartedAt: FieldValue.delete(),
      });
    });
    return { id: docRef.id, ...shipmentData };
  }

  /**
   * Get a shipment by its ID
   * @param id - Shipment ID
   * @returns Shipment or null if not found
   */
  async getShipmentById(id: string): Promise<Shipment | null> {
    const doc = await firestore.collection(this.collection).doc(id).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    return this.mapToShipment(doc.id, data);
  }

  /**
   * Get a shipment by order ID
   * @param orderId - Order ID
   * @returns Shipment or null if not found
   */
  async getShipmentByOrderId(orderId: string): Promise<Shipment | null> {
    const snapshot = await firestore
      .collection(this.collection)
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    return this.mapToShipment(doc.id, data);
  }

  /**
   * Get shipment by Sendcloud ID
   * @param sendcloudId - Sendcloud parcel ID
   * @returns Shipment or null if not found
   */
  async getShipmentBySendcloudId(
    sendcloudId: number,
  ): Promise<Shipment | null> {
    const snapshot = await firestore
      .collection(this.collection)
      .where('sendcloudId', '==', sendcloudId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    return this.mapToShipment(doc.id, data);
  }

  /**
   * Update a shipment
   * @param id - Shipment ID
   * @param updates - Fields to update
   */
  async updateShipment(id: string, updates: Partial<Shipment>): Promise<void> {
    const ref = firestore.collection(this.collection).doc(id);
    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists || doc.get('deletionMinimised') === true) return;
      transaction.update(ref, { ...updates, updatedAt: new Date() });
    });
  }

  /**
   * Get all shipments (optionally filtered by status)
   * @param status - Optional status filter
   * @returns Array of shipments
   */
  async getAllShipments(status?: string): Promise<Shipment[]> {
    let query: any = firestore.collection(this.collection);

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.orderBy('createdAt', 'desc').get();

    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return this.mapToShipment(doc.id, data);
    });
  }

  /**
   * Delete a shipment
   * @param id - Shipment ID
   */
  async deleteShipment(id: string): Promise<void> {
    await firestore.collection(this.collection).doc(id).delete();
  }

  /**
   * Get shipments by user ID (through order lookup)
   * @param userId - User ID
   * @returns Array of shipments
   */
  async getShipmentsByUserId(userId: string): Promise<Shipment[]> {
    // This would require getting orders first, then finding shipments
    // For now, we'll return an empty array and implement later if needed
    return [];
  }

  /**
   * Map Firestore data to Shipment model
   * @param id - Document ID
   * @param data - Firestore document data
   * @returns Shipment object
   */
  private mapToShipment(id: string, data: any): Shipment {
    // Handle Firestore Timestamp conversion
    let createdAt = data.createdAt;
    let updatedAt = data.updatedAt;

    if (createdAt && typeof createdAt.toDate === 'function') {
      createdAt = createdAt.toDate();
    } else if (createdAt) {
      createdAt = new Date(createdAt);
    }

    if (updatedAt && typeof updatedAt.toDate === 'function') {
      updatedAt = updatedAt.toDate();
    } else if (updatedAt) {
      updatedAt = new Date(updatedAt);
    }

    return {
      id,
      orderId: data.orderId,
      deliveryType: data.deliveryType,
      shippingOptionId: data.shippingOptionId,
      provider: data.provider,
      checkoutIdentifier: data.checkoutIdentifier,
      pickupPoint: data.pickupPoint,
      sendcloudId: data.sendcloudId,
      trackingNumber: data.trackingNumber,
      trackingUrl: data.trackingUrl,
      carrier: data.carrier,
      status: data.status,
      labelUrl: data.labelUrl,
      parcel: data.parcel,
      createdAt,
      updatedAt,
    };
  }
}
