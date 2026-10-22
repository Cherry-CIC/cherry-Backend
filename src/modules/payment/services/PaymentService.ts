import {
  ListingSafetyError,
  listingEditVersion,
} from '../../../shared/utils/listingSafety';
import { PaymentRepository } from '../PaymentRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { stripe } from '../../../shared/config/stripeConfig';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { CheckoutShippingService } from '../../shipping/services/CheckoutShippingService';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { gbpToPence } from '../../../shared/utils/money';
import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';
import {
  OrderRepository,
  PaymentOrderMismatchError,
  PendingOrderUnavailableError,
} from '../../order/repositories/OrderRepository';
import { Order } from '../../order/model/Order';
import { OrderFulfillmentService } from '../../order/services/OrderFulfillmentService';

export interface CreatePaymentSelection {
  productId: string;
  expectedEditVersion?: number;
  shippingMethodId: string;
  pickupPointId: string;
  country: string;
  postalCode: string;
  shipping: Order['shipping'];
  pickupPoint: Order['pickupPoint'];
}

export interface VerifiedCheckoutPayment {
  paymentIntentId: string;
  firebaseUid: string;
  orderId: string;
  sellerId: string;
  charityId: string;
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
  private orderRepo = new OrderRepository();
  private orderFulfillmentService = new OrderFulfillmentService();

  async createPaymentIntentForUserByUid(
    firebaseUid: string,
    orderId: string,
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

    if (product.userId === firebaseUid) {
      throw new ListingSafetyError(
        403,
        'SELF_PURCHASE_NOT_ALLOWED',
        'You cannot buy your own listing.',
      );
    }
    const quotedRevision = listingEditVersion(product);
    if (
      selection.expectedEditVersion !== undefined &&
      selection.expectedEditVersion !== quotedRevision
    ) {
      throw new ListingSafetyError(
        409,
        'LISTING_VERSION_CONFLICT',
        'This listing changed. Reopen it before paying.',
      );
    }
    if (
      selection.expectedEditVersion === undefined &&
      product.hasBeenEdited === true
    ) {
      throw new ListingSafetyError(
        409,
        'LISTING_VERSION_REQUIRED',
        'Reopen this edited listing before paying.',
      );
    }

    if (product.number <= 0) {
      throw new Error('Product is out of stock');
    }
    if (!product.userId || !product.charityId || !user.email) {
      throw new Error('Checkout product or customer details are incomplete');
    }

    if (
      selection.pickupPoint.id !== selection.pickupPointId ||
      selection.pickupPoint.country !== selection.country ||
      selection.shipping.address.country !== selection.country ||
      this.normalizePostalCode(selection.pickupPoint.postalCode) !==
        this.normalizePostalCode(selection.postalCode) ||
      this.normalizePostalCode(selection.shipping.address.postal_code) !==
        this.normalizePostalCode(selection.postalCode)
    ) {
      throw new Error('Checkout delivery details do not match the selection');
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

    await this.reconcileExpiredOrders(selection.productId);

    const stripeCustomerId = await this.paymentRepo.getOrCreateCustomerId(
      user.email,
    );
    const order = await this.orderRepo.createPendingOrder(
      orderId,
      {
        listingEditVersion: quotedRevision,
        stripeCustomerId,
        userId: firebaseUid,
        sellerId: product.userId,
        charityId: product.charityId,
        email: user.email,
        productAmount,
        shippingFee,
        securityFee,
        totalAmount,
        currency: 'GBP',
        productId: selection.productId,
        productName: product.name,
        deliveryType: 'pickup_point',
        shippingOptionId: shippingMethod.id,
        shippingOptionName: shippingMethod.name,
        shippingCarrier: sendcloudConfig.enforcedCarrier,
        shippingWeight: postageSize.weight,
        shipping: selection.shipping,
        pickupPoint: selection.pickupPoint,
      },
      selection.expectedEditVersion,
    );

    const payment = await this.recoverPayment(order);
    await this.orderRepo.attachPaymentIntent(order.id, payment.paymentIntentId);
    if (payment.paymentStatus === 'canceled') {
      await this.orderRepo.releasePendingOrder(
        order.id,
        payment.paymentIntentId,
      );
      throw new ListingSafetyError(
        409,
        'CHECKOUT_FINISHED',
        'This payment was cancelled. Reopen the listing before paying.',
      );
    }
    return {
      ...payment,
      orderId: order.id,
      productAmount: order.productAmount,
      shippingFee: order.shippingFee,
      securityFee: order.securityFee,
      totalAmount: order.totalAmount,
      currency: order.currency,
    };
  }

  private async recoverPayment(order: Order) {
    if (
      !order.stripeCustomerId ||
      (!order.paymentIntentId &&
        Date.now() - order.createdAt.getTime() >= 23 * 60 * 60 * 1000)
    ) {
      throw new ListingSafetyError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'This pending payment needs review before it can be retried.',
      );
    }

    const metadata = {
      firebaseUid: order.userId,
      orderId: order.id,
      sellerId: order.sellerId,
      charityId: order.charityId,
      productId: order.productId,
      shippingMethodId: order.shippingOptionId,
      shippingMethodName: order.shippingOptionName,
      pickupPointId: order.pickupPoint.id,
      destinationCountry: order.pickupPoint.country,
      destinationPostalCode: order.pickupPoint.postalCode,
      shippingCarrier: order.shippingCarrier,
      shippingWeight: String(order.shippingWeight),
      productAmount: String(order.productAmount),
      shippingFee: String(order.shippingFee),
      securityFee: String(order.securityFee),
      totalAmount: String(order.totalAmount),
    };

    // Timeouts can occur after Stripe creates the intent. Retain the pending
    // order and replay its frozen arguments with the same idempotency key.
    return this.paymentRepo.createPaymentIntentForUser(
      order.totalAmount,
      metadata,
      order.stripeCustomerId,
      order.paymentIntentId,
    );
  }

  /** Expiry is a request to reconcile with Stripe, never permission to unlock. */
  async reconcileExpiredOrders(productId: string): Promise<void> {
    const orders = await this.orderRepo.getPendingOrdersForProduct(productId);
    for (const order of orders) {
      if (
        !order.paymentExpiresAt ||
        order.paymentExpiresAt.getTime() > Date.now()
      )
        continue;
      let intentId = order.paymentIntentId;
      if (!intentId) {
        // A lost creation response is recoverable only within Stripe's key window.
        // Frozen arguments ensure recovery cannot create a differently priced intent.
        const recovered = await this.recoverPayment(order);
        intentId = recovered.paymentIntentId;
        await this.orderRepo.attachPaymentIntent(order.id, intentId);
      }
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (
        intent.metadata.orderId !== order.id ||
        intent.metadata.firebaseUid !== order.userId
      ) {
        throw new ListingSafetyError(
          409,
          'PAYMENT_RECONCILIATION_REQUIRED',
          'A pending payment needs review.',
        );
      }
      if (intent.status === 'succeeded') {
        await this.handleSucceededPaymentIntent(intentId);
      } else if (intent.status !== 'processing') {
        await this.cancelPaymentIntentForUser(order.userId, intentId);
      }
    }
  }

  async cancelPaymentIntentForUser(
    firebaseUid: string,
    paymentIntentId: string,
  ): Promise<void> {
    let intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const orderId = intent.metadata.orderId;
    if (intent.metadata.firebaseUid !== firebaseUid || !orderId) {
      throw new ListingSafetyError(
        403,
        'PAYMENT_NOT_OWNER',
        'This payment does not belong to your account.',
      );
    }
    const order = await this.orderRepo.getOrderById(orderId);
    if (
      !order ||
      order.userId !== firebaseUid ||
      order.paymentIntentId !== paymentIntentId ||
      order.productId !== intent.metadata.productId
    ) {
      throw new ListingSafetyError(
        409,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'The payment does not match its order.',
      );
    }
    if (intent.status !== 'canceled') {
      if (intent.status === 'succeeded' || intent.status === 'processing') {
        throw new ListingSafetyError(
          409,
          'PAYMENT_STILL_ACTIONABLE',
          'The payment has completed or is processing. Finish or check your order.',
        );
      }
      try {
        intent = await stripe.paymentIntents.cancel(paymentIntentId);
      } catch {
        // Confirmation may have raced cancellation, or the response was lost.
        intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      }
    }
    if (intent.status !== 'canceled') {
      throw new ListingSafetyError(
        409,
        'PAYMENT_STILL_ACTIONABLE',
        'Payment cancellation could not be confirmed.',
      );
    }
    await this.orderRepo.releasePendingOrder(orderId, paymentIntentId);
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

    if (!metadata.orderId || !metadata.sellerId || !metadata.charityId) {
      throw new Error('Payment order metadata is incomplete');
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

    return {
      paymentIntentId: paymentIntent.id,
      firebaseUid,
      orderId: metadata.orderId,
      sellerId: metadata.sellerId,
      charityId: metadata.charityId,
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

  async handleSucceededPaymentIntent(paymentIntentId: string): Promise<void> {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const firebaseUid = paymentIntent.metadata.firebaseUid;
    if (!firebaseUid) {
      throw new Error('Payment is missing its customer metadata');
    }

    const verifiedPayment = await this.verifySucceededPaymentIntentForUser(
      firebaseUid,
      paymentIntentId,
    );

    try {
      await this.orderRepo.finalizePendingOrder(
        verifiedPayment.orderId,
        paymentIntentId,
        this.toVerifiedOrderPayment(verifiedPayment),
      );
    } catch (error) {
      if (
        !(error instanceof PendingOrderUnavailableError) &&
        !(error instanceof PaymentOrderMismatchError)
      ) {
        throw error;
      }

      await this.refundUnavailablePayment(
        verifiedPayment.orderId,
        paymentIntentId,
      );
      return;
    }

    await this.orderFulfillmentService.processPaidOrder(
      verifiedPayment.orderId,
    );
  }

  async refundUnavailablePayment(
    orderId: string,
    paymentIntentId: string,
  ): Promise<void> {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `late-checkout-refund-${paymentIntentId}` },
    );
    await this.orderRepo.markPaymentRefunded(orderId, paymentIntentId);
  }

  async handleCanceledPaymentIntent(
    paymentIntentId: string,
    orderId: string | undefined,
  ): Promise<void> {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (
      !orderId ||
      intent.metadata.orderId !== orderId ||
      intent.status !== 'canceled'
    ) {
      throw new Error('Payment cancellation is not confirmed for this order');
    }
    await this.cancelPaymentIntentForUser(
      intent.metadata.firebaseUid,
      paymentIntentId,
    );
  }

  private parseMetadataInteger(
    value: string | undefined,
    field: string,
  ): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Payment metadata ${field} is invalid`);
    }
    return parsed;
  }

  private normalizePostalCode(postalCode: string): string {
    return postalCode.replace(/\s/g, '').toUpperCase();
  }

  private toVerifiedOrderPayment(payment: VerifiedCheckoutPayment) {
    return {
      userId: payment.firebaseUid,
      sellerId: payment.sellerId,
      charityId: payment.charityId,
      productId: payment.productId,
      shippingMethodId: payment.shippingMethodId,
      shippingMethodName: payment.shippingMethodName,
      pickupPointId: payment.pickupPointId,
      destinationCountry: payment.destinationCountry,
      destinationPostalCode: payment.destinationPostalCode,
      shippingCarrier: payment.shippingCarrier,
      shippingWeight: payment.shippingWeight,
      productAmount: payment.productAmount,
      shippingFee: payment.shippingFee,
      securityFee: payment.securityFee,
      totalAmount: payment.totalAmount,
      currency: payment.currency,
    };
  }
}
