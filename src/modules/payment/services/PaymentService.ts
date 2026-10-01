import { createHash } from 'crypto';
import {
  ListingReservation,
  ListingReservationRepository,
  SAFE_STRIPE_RETRY_MS,
} from '../repositories/ListingReservationRepository';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';
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
  expectedEditVersion?: number;
  productId: string;
  shippingMethodId: string;
  pickupPointId: string;
  country: string;
  postalCode: string;
}

export interface VerifiedCheckoutPayment {
  listingReservationId?: string;
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
  private reservations = new ListingReservationRepository();
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

    const selectionKey = createHash('sha256')
      .update(
        JSON.stringify({
          productId: selection.productId,
          shippingMethodId: selection.shippingMethodId,
          pickupPointId: selection.pickupPointId,
          country: selection.country,
          postalCode: selection.postalCode,
        }),
      )
      .digest('hex');
    const existing = await this.reservations.activeForProduct(
      selection.productId,
    );
    if (existing) {
      if (
        existing.expiresAtMs <= Date.now() &&
        ['creating', 'active'].includes(existing.state)
      ) {
        await this.cancelReservation(existing);
        throw new ListingSafetyError(
          409,
          'CHECKOUT_EXPIRED',
          'The previous checkout has expired. Refresh this listing.',
        );
      }
      if (
        existing.userId !== firebaseUid ||
        existing.selectionKey !== selectionKey
      )
        throw new ListingSafetyError(
          409,
          'LISTING_PAYMENT_PENDING',
          'A payment is already in progress for this listing.',
        );
      if (
        selection.expectedEditVersion !== undefined &&
        ![existing.reviewedVersion, existing.reservedVersion].includes(
          selection.expectedEditVersion,
        )
      )
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_CONFLICT',
          'Refresh this listing before paying.',
        );
      // Missing-version retries are permitted only for the same reservation.
      return this.materialisePayment(existing);
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

    const customerId = await this.paymentRepo.customerForEmail(user.email);
    const reservation = await this.reservations.reserve({
      productId: selection.productId,
      userId: firebaseUid,
      customerId,
      expectedEditVersion: selection.expectedEditVersion,
      quotedVersion: product.editVersion ?? 0,
      selectionKey,
      quotedPrice: product.price,
      quotedPostageSize: product.postageSize,
      metadata,
      totalAmount,
    });
    return this.materialisePayment(reservation);
  }

  private async intentForReservation(reservation: ListingReservation) {
    if (reservation.paymentIntentId)
      return stripe.paymentIntents.retrieve(reservation.paymentIntentId);
    if (Date.now() - reservation.createdAtMs >= SAFE_STRIPE_RETRY_MS)
      throw new ListingSafetyError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'This checkout needs support review.',
      );
    const intent = await this.paymentRepo.createPaymentIntentForUser(
      reservation.customerId,
      reservation.totalAmount,
      reservation.metadata,
      `listing-reservation-${reservation.id}`,
    );
    await this.reservations.attachIntent(reservation, intent.id);
    return intent;
  }

  private async materialisePayment(reservation: ListingReservation) {
    if (!['creating', 'active'].includes(reservation.state))
      throw new ListingSafetyError(
        409,
        'CHECKOUT_FINISHED',
        'This checkout has already finished.',
      );
    const intent = await this.intentForReservation(reservation);
    await this.reservations.applyStripeState(intent);
    if (['succeeded', 'canceled'].includes(intent.status))
      throw new ListingSafetyError(
        409,
        'CHECKOUT_FINISHED',
        'This checkout has already finished.',
      );
    const payment = await this.paymentRepo.clientResponse(
      reservation.customerId,
      intent,
    );
    return {
      ...payment,
      productAmount: Number(reservation.metadata.productAmount),
      shippingFee: Number(reservation.metadata.shippingFee),
      securityFee: Number(reservation.metadata.securityFee),
      totalAmount: reservation.totalAmount,
      currency: 'GBP',
    };
  }

  private async cancelReservation(
    reservation: ListingReservation,
  ): Promise<void> {
    let intent = await this.intentForReservation(reservation);
    if (!['succeeded', 'canceled'].includes(intent.status)) {
      try {
        intent = await stripe.paymentIntents.cancel(intent.id);
      } catch {
        intent = await stripe.paymentIntents.retrieve(intent.id);
      }
    }
    await this.reservations.applyStripeState(intent);
    if (intent.status !== 'canceled')
      throw new ListingSafetyError(
        409,
        'PAYMENT_STILL_ACTIONABLE',
        'This payment cannot yet be cancelled.',
      );
  }

  async cancelPaymentForUser(
    uid: string,
    paymentIntentId: string,
  ): Promise<void> {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.metadata.firebaseUid !== uid)
      throw new ListingSafetyError(
        403,
        'PAYMENT_NOT_OWNER',
        'This payment belongs to another account.',
      );
    const id = intent.metadata.listingReservationId;
    const reservation = id ? await this.reservations.get(id) : null;
    if (
      !reservation ||
      reservation.userId !== uid ||
      reservation.paymentIntentId !== intent.id
    )
      throw new ListingSafetyError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'This checkout needs support review.',
      );
    await this.cancelReservation(reservation);
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

    const productAmount = this.parseMetadataInteger(
      metadata.productAmount,
      'productAmount',
    );
    const shippingFee = this.parseMetadataInteger(
      metadata.shippingFee,
      'shippingFee',
    );
    const securityFee = this.parseMetadataInteger(
      metadata.securityFee,
      'securityFee',
    );
    const totalAmount = this.parseMetadataInteger(
      metadata.totalAmount,
      'totalAmount',
    );
    const shippingWeight = this.parseMetadataInteger(
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

    await this.reservations.applyStripeState(paymentIntent);
    return {
      listingReservationId: metadata.listingReservationId || undefined,
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

  private parseMetadataInteger(
    value: string | undefined,
    field: string,
  ): number {
    const parsed = Number(value);
    if (!value || !Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Payment metadata ${field} is invalid`);
    }
    return parsed;
  }
}
