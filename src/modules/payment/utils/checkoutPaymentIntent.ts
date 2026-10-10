import Stripe from 'stripe';

// Checkout details stored in PaymentIntent metadata at checkout. Amounts in pence.
export interface CheckoutPaymentDetails {
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
}

const parseMetadataInteger = (
  value: string | undefined,
  field: string,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Payment metadata ${field} is invalid`);
  }
  return parsed;
};

// Shared by POST /api/order and the Stripe webhook so both apply the same checks
export const parseCheckoutPaymentIntent = (
  paymentIntent: Pick<Stripe.PaymentIntent, 'amount' | 'metadata'>,
): CheckoutPaymentDetails => {
  const metadata = paymentIntent.metadata ?? {};

  const productAmount = parseMetadataInteger(
    metadata.productAmount,
    'productAmount',
  );
  const shippingFee = parseMetadataInteger(metadata.shippingFee, 'shippingFee');
  const securityFee = parseMetadataInteger(metadata.securityFee, 'securityFee');
  const totalAmount = parseMetadataInteger(metadata.totalAmount, 'totalAmount');
  const shippingWeight = parseMetadataInteger(
    metadata.shippingWeight,
    'shippingWeight',
  );

  if (productAmount + shippingFee + securityFee !== totalAmount) {
    throw new Error('Payment pricing metadata is inconsistent');
  }

  if (paymentIntent.amount !== totalAmount) {
    throw new Error('Payment amount does not match order amount');
  }

  if (
    !metadata.productId ||
    !metadata.shippingMethodId ||
    !metadata.shippingMethodName ||
    !metadata.pickupPointId ||
    !metadata.destinationCountry ||
    !metadata.destinationPostalCode ||
    !metadata.shippingCarrier
  ) {
    throw new Error('Payment checkout metadata is incomplete');
  }

  return {
    productId: metadata.productId,
    shippingMethodId: metadata.shippingMethodId,
    shippingMethodName: metadata.shippingMethodName,
    pickupPointId: metadata.pickupPointId,
    destinationCountry: metadata.destinationCountry,
    destinationPostalCode: metadata.destinationPostalCode,
    shippingCarrier: metadata.shippingCarrier,
    shippingWeight,
    productAmount,
    shippingFee,
    securityFee,
    totalAmount,
  };
};
