import { firestore } from '../shared/config/firebaseConfig';
import { OrderDisputeReason } from '../modules/order/model/Order';
import { Dispute, DisputeSubmissionError } from './Dispute';

export interface CreateBuyerDisputeInput {
  orderId: string;
  buyerId: string;
  reason: OrderDisputeReason;
  message?: string;
}

export class DisputeRepository {
  async createBuyerDispute(input: CreateBuyerDisputeInput): Promise<Dispute> {
    const orderRef = firestore.collection('orders').doc(input.orderId);
    const disputes = firestore.collection('disputes');
    let disputeRef = disputes.doc();
    while (disputeRef.id === input.orderId) {
      disputeRef = disputes.doc();
    }
    const eventRef = disputeRef.collection('events').doc();

    return firestore.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists) {
        throw new DisputeSubmissionError('order_not_found');
      }

      const order = orderSnapshot.data()!;
      if (order.userId !== input.buyerId) {
        throw new DisputeSubmissionError('not_order_owner');
      }

      if (
        order.buyerDisputeStatus ||
        (order.status !== 'delivered' && order.shipmentStatus !== 'delivered')
      ) {
        throw new DisputeSubmissionError('order_not_eligible');
      }

      const productSnapshot = await transaction.get(
        firestore.collection('products').doc(order.productId),
      );
      const sellerId = productSnapshot.data()?.userId;
      if (typeof sellerId !== 'string') {
        throw new Error('Seller not found for dispute order');
      }
      const now = new Date();
      const dispute: Dispute = {
        disputeId: disputeRef.id,
        orderId: input.orderId,
        buyerId: input.buyerId,
        sellerId,
        productId: order.productId,
        productName: order.productName,
        reason: input.reason,
        ...(input.message ? { message: input.message } : {}),
        status: 'under_review',
        orderSnapshot: {
          totalAmount: order.totalAmount,
          currency: order.currency,
          paymentIntentId: order.paymentIntentId,
          orderStatus: order.status,
          shipmentStatus: order.shipmentStatus,
        },
        evidence: [],
        createdAt: now,
        updatedAt: now,
      };

      transaction.create(disputeRef, dispute);
      transaction.create(eventRef, {
        type: 'submitted',
        actorId: input.buyerId,
        actorRole: 'buyer',
        fromStatus: null,
        toStatus: 'under_review',
        createdAt: now,
      });
      transaction.update(orderRef, {
        buyerDisputeId: dispute.disputeId,
        buyerDisputeReason: dispute.reason,
        buyerDisputeStatus: 'under_review',
        ...(dispute.message ? { buyerDisputeMessage: dispute.message } : {}),
        buyerDisputedAt: now,
      });

      return dispute;
    });
  }
}