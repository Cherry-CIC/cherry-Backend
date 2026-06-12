import { PaymentRepository } from '../PaymentRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { stripe } from '../../../shared/config/stripeConfig';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { CheckoutShippingService } from '../../shipping/services/CheckoutShippingService';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { gbpToPence } from '../../../shared/utils/money';
import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';

export interface CreatePaymentSelection {
  productId: string;
  shippingMethodId: string;
  pickupPointId: string;
  country: string;
  postalCode: string;
}

export interface VerifiedCheckoutPayment {
  paymentIntentId: string;
  firebaseUid: string;
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

export class PaymentService {
  private paymentRepo = new PaymentRepository();
  private userRepo = new UserRepository();
  private productRepo = new ProductRepository();
  private postageSizeRepo = new PostageSizeRepository();
  private shippingService = new CheckoutShippingService();

  async createPaymentIntentForUserByUid(
    firebaseUid: string,
    selection: CreatePaymentSelection,
  ) {
    const user = await this.userRepo.getById(firebaseUid);
    if (!user) {
      throw new Error('User not found');
    }

    const product = await this.productRepo.getById(selection.productId);
    if (!product) {
      throw new Error('Product not found');
    }

    if (product.number <= 0) {
      throw new Error('Product is out of stock');
    }

    if (!product.postageSize) {
      throw new Error('Product postage size is missing');
    }

    const postageSize = await this.postageSizeRepo.getById(product.postageSize);
    if (!postageSize) {
      throw new Error('Postage size not found');
    }

    const shippingMethods = await this.shippingService.getDeliveryOptions({
      servicePointId: selection.pickupPointId,
      country: selection.country,
      postalCode: selection.postalCode,
      weightGrams: postageSize.weight,
      carrier: sendcloudConfig.enforcedCarrier,
    });
    const shippingMethod = shippingMethods.find(
      (method) => method.id === selection.shippingMethodId,
    );

    if (!shippingMethod || shippingMethod.pricePence === null) {
      throw new Error('Selected shipping method is unavailable');
    }

    if (shippingMethod.currency !== 'GBP') {
      throw new Error('Selected shipping method must be priced in GBP');
    }

    const productAmount = gbpToPence(product.price);
    const shippingFee = shippingMethod.pricePence;
    const securityFee = calculateSecurityFeePence(productAmount);
    const totalAmount = productAmount + shippingFee + securityFee;
    const metadata = {
      firebaseUid,
      productId: selection.productId,
      shippingMethodId: shippingMethod.id,
      shippingMethodName: shippingMethod.name,
      pickupPointId: selection.pickupPointId,
      destinationCountry: selection.country,
      destinationPostalCode: selection.postalCode,
      shippingCarrier: sendcloudConfig.enforcedCarrier,
      shippingWeight: String(postageSize.weight),
      productAmount: String(productAmount),
      shippingFee: String(shippingFee),
      securityFee: String(securityFee),
      totalAmount: String(totalAmount),
    };

    const payment = await this.paymentRepo.createPaymentIntentForUser(
      user.email,
      totalAmount,
      metadata,
    );

    return {
      ...payment,
      productAmount,
      shippingFee,
      securityFee,
      totalAmount,
      currency: 'GBP',
    };
  }

  async verifySucceededPaymentIntentForUser(
    firebaseUid: string,
    paymentIntentId: string,
  ): Promise<VerifiedCheckoutPayment> {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      throw new Error('Payment has not succeeded');
    }

    if (paymentIntent.currency.toLowerCase() !== 'gbp') {
      throw new Error('Payment currency must be GBP');
    }

    const metadata = paymentIntent.metadata;
    if (metadata.firebaseUid !== firebaseUid) {
      throw new Error('Payment does not belong to the authenticated user');
    }

    const productAmount = this.parseMetadataInteger(metadata.productAmount, 'productAmount');
    const shippingFee = this.parseMetadataInteger(metadata.shippingFee, 'shippingFee');
    const securityFee = this.parseMetadataInteger(metadata.securityFee, 'securityFee');
    const totalAmount = this.parseMetadataInteger(metadata.totalAmount, 'totalAmount');
    const shippingWeight = this.parseMetadataInteger(metadata.shippingWeight, 'shippingWeight');

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
      paymentIntentId: paymentIntent.id,
      firebaseUid,
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
      currency: 'GBP',
    };
  }

  private parseMetadataInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Payment metadata ${field} is invalid`);
    }
    return parsed;
  }
}
