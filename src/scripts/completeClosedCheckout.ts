import 'dotenv/config';
import { readFileSync } from 'fs';
import { firestore } from '../shared/config/firebaseConfig';
import { loadDeletionPolicy } from '../modules/account-deletion/config';
import { orderSchema } from '../modules/order/validators/orderValidator';
import { PaymentService } from '../modules/payment/services/PaymentService';
import { OrderRepository } from '../modules/order/repositories/OrderRepository';

/** Restricted operator workflow after independently verifying the customer's identity.
 * Records a previously paid order only. No refund, cancellation, payout or label purchase.
 */
async function main() {
  loadDeletionPolicy();
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (
    typeof input.evidenceReference !== 'string' ||
    input.evidenceReference.trim().length < 8 ||
    input.evidenceReference.length > 500 ||
    typeof input.reviewer !== 'string' ||
    input.reviewer.trim().length < 3 ||
    input.reviewer.length > 200 ||
    !/^[a-f0-9-]{36}$/.test(input.checkoutId)
  )
    throw new Error('Verification evidence required');
  const contextRef = firestore
    .collection('account_checkout_contexts')
    .doc(input.checkoutId);
  const context = (await contextRef.get()).data();
  if (!context?.paymentIntentId) throw new Error('Payment context missing');
  const { value, error } = orderSchema.validate(input.order);
  if (error) throw error;
  const payment =
    await new PaymentService().verifySucceededPaymentIntentForUser(
      context.buyerUid,
      context.paymentIntentId,
    );
  if (
    payment.checkoutSessionId !== input.checkoutId ||
    payment.productId !== value.productId ||
    payment.paymentIntentId !== value.paymentIntentId ||
    payment.pickupPointId !== value.pickupPoint.id ||
    payment.destinationCountry !== value.shipping.address.country ||
    payment.destinationPostalCode.replace(/\s/g, '').toUpperCase() !==
      value.shipping.address.postal_code.replace(/\s/g, '').toUpperCase()
  )
    throw new Error('Paid selection mismatch');
  if (!process.argv.includes('--apply')) {
    console.log(
      'Validated paid checkout; no changes made. Use --apply after verification.',
    );
    return;
  }
  const order =
    await new OrderRepository().createPaidOrderAndDecrementInventory({
      checkoutSessionId: input.checkoutId,
      supportReview: {
        reviewer: input.reviewer,
        evidenceReference: input.evidenceReference,
      },
      userId: context.buyerUid,
      email: context.buyerEmail,
      productId: payment.productId,
      productName: context.productName,
      productAmount: payment.productAmount,
      shippingFee: payment.shippingFee,
      securityFee: payment.securityFee,
      totalAmount: payment.totalAmount,
      currency: 'GBP',
      deliveryType: 'pickup_point',
      shippingOptionId: payment.shippingMethodId,
      shippingOptionName: payment.shippingMethodName,
      shippingCarrier: payment.shippingCarrier,
      shippingWeight: payment.shippingWeight,
      shipping: value.shipping,
      pickupPoint: value.pickupPoint,
      paymentIntentId: payment.paymentIntentId,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'shipment_pending',
    });
  console.log(
    JSON.stringify({
      event: 'paid_order_recorded_for_fulfilment',
      orderId: order.id,
    }),
  );
}
main().catch(() => {
  console.error(
    'Closed-account checkout could not be completed; inspect verified payment and restricted context.',
  );
  process.exitCode = 1;
});
