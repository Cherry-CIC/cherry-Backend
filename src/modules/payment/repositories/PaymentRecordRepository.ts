import { firestore } from '../../../shared/config/firebaseConfig';
import { PaymentRecordInput } from '../model/PaymentRecord';

export interface RecordPaymentResult {
  orderId: string | null;
  keptExistingPaid: boolean;
}

export class PaymentRecordRepository {
  // Keyed by PaymentIntent ID and run in one transaction, so Stripe retries are safe.
  async recordPayment(input: PaymentRecordInput): Promise<RecordPaymentResult> {
    const paymentRef = firestore
      .collection('payments')
      .doc(input.paymentIntentId);
    // Written by OrderRepository when the order is created
    const lockRef = firestore
      .collection('order_payment_intents')
      .doc(input.paymentIntentId);

    return firestore.runTransaction(async (transaction) => {
      const [paymentDoc, lockDoc] = await Promise.all([
        transaction.get(paymentRef),
        transaction.get(lockRef),
      ]);

      const existing = paymentDoc.exists ? paymentDoc.data()! : null;
      const lockedOrderId =
        lockDoc.exists && typeof lockDoc.data()!.orderId === 'string'
          ? (lockDoc.data()!.orderId as string)
          : null;
      const orderId =
        lockedOrderId ??
        (typeof existing?.orderId === 'string' ? existing.orderId : null);

      // Never downgrade a verified payment to flagged
      if (existing?.status === 'paid' && input.status === 'flagged') {
        return { orderId, keptExistingPaid: true };
      }

      const orderRef = orderId
        ? firestore.collection('orders').doc(orderId)
        : null;
      const orderDoc = orderRef ? await transaction.get(orderRef) : null;

      const stripeChargeId =
        input.stripeChargeId ?? existing?.stripeChargeId ?? null;
      const stripeBalanceTransactionId =
        input.stripeBalanceTransactionId ??
        existing?.stripeBalanceTransactionId ??
        null;

      const now = new Date();
      transaction.set(paymentRef, {
        ...input,
        stripeChargeId,
        stripeBalanceTransactionId,
        orderId,
        firstReceivedAt: existing?.firstReceivedAt ?? now,
        updatedAt: now,
      });

      if (input.status === 'paid' && orderRef && orderDoc?.exists) {
        transaction.update(orderRef, {
          paymentStatus: 'succeeded',
          stripeChargeId,
          stripeBalanceTransactionId,
          paidAt: input.paidAt,
        });
      }

      return { orderId, keptExistingPaid: false };
    });
  }
}
