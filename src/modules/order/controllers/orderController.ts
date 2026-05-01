import { Request, Response } from 'express';
import Stripe from 'stripe';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { Order } from '../model/Order';
import { Product } from '../../products/model/Product';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PaymentService } from '../../payment/services/PaymentService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { createShippingProvider } from '../../shipping/services/ShippingProviderFactory';
import { ShippingParcelRequest } from '../../shipping/services/ShippingProvider';

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

type DeliveryType = 'home' | 'pickup_point';

interface ShippingOption {
  id: string;
  deliveryType: DeliveryType;
  deliveryMethod: 'ship_to_home' | 'pickup_point';
  name: string;
  pricePence: number;
  carrier: string;
}

const MVP_SHIPPING_OPTIONS: Record<string, ShippingOption> = {
  'mvp-home-delivery': {
    id: 'mvp-home-delivery',
    deliveryType: 'home',
    deliveryMethod: 'ship_to_home',
    name: 'MVP home delivery',
    pricePence: 299,
    carrier: 'evri',
  },
  'mvp-pickup-point-delivery': {
    id: 'mvp-pickup-point-delivery',
    deliveryType: 'pickup_point',
    deliveryMethod: 'pickup_point',
    name: 'MVP pick-up point delivery',
    pricePence: 0,
    carrier: 'inpost',
  },
};

const normaliseDeliveryType = (body: any): DeliveryType | null => {
  if (body.deliveryType === 'home' || body.deliveryMethod === 'ship_to_home') {
    return 'home';
  }

  if (
    body.deliveryType === 'pickup_point' ||
    body.deliveryMethod === 'pickup_point'
  ) {
    return 'pickup_point';
  }

  return null;
};

const productPriceToPence = (product: Product): number => {
  if (!Number.isFinite(product.price) || product.price <= 0) {
    throw new Error('Product price is invalid');
  }

  // Product prices are stored in pounds in the current product catalogue.
  return Math.round(product.price * 100);
};

const getPaymentIntentCustomerId = (customer: unknown): string | null => {
  if (typeof customer === 'string') return customer;
  if (customer && typeof customer === 'object' && 'id' in customer) {
    const customerId = (customer as { id?: unknown }).id;
    return typeof customerId === 'string' ? customerId : null;
  }

  return null;
};

const buildProductSnapshot = (product: Product): Order['productSnapshot'] => ({
  id: product.id,
  name: product.name,
  charityId: product.charityId,
  price: product.price,
  donation: product.donation,
});

const buildPickupPoint = (pickupPoint: any): Order['pickupPoint'] => {
  if (!pickupPoint) return undefined;

  return {
    id: pickupPoint.id,
    name: pickupPoint.name,
    addressLine1: pickupPoint.addressLine1,
    city: pickupPoint.city,
    postalCode: pickupPoint.postalCode,
    country: pickupPoint.country || 'GB',
    carrier: pickupPoint.carrier,
  };
};

/**
 * Creates a Sendcloud parcel for a ship_to_home order and writes the
 * resulting tracking number back onto the saved order.
 */
async function createShipToHomeParcel(
  savedOrder: Order,
  shipping: any,
  email: string,
  weight: number,
): Promise<{ shipmentId: string; shipmentStatus: 'announced' }> {
  const shippingProvider = createShippingProvider();
  const shipmentRepo = new ShipmentRepository();
  const orderRepo = new OrderRepository();

  const parcelData: ShippingParcelRequest = {
    name: shipping.name || 'Customer',
    address: shipping.address.line1,
    address_2: shipping.address.line2 || '',
    city: shipping.address.city,
    postal_code: shipping.address.postal_code,
    country: shipping.address.country || 'GB',
    email,
    order_number: savedOrder.id,
    weight,
  };

  const sendcloudParcel = await shippingProvider.createParcel(parcelData);

  const shipment = await shipmentRepo.createShipment({
    orderId: savedOrder.id,
    sendcloudId: sendcloudParcel.id,
    trackingNumber: sendcloudParcel.tracking_number,
    trackingUrl: sendcloudParcel.tracking_url,
    carrier: sendcloudParcel.carrier?.name,
    status: 'announced',
    labelUrl: sendcloudParcel.label?.label_printer,
    deliveryMethod: 'ship_to_home',
    parcel: parcelData,
  });

  if (sendcloudParcel.tracking_number) {
    await orderRepo.updateOrderTracking(
      savedOrder.id,
      sendcloudParcel.tracking_number,
      shipment.id,
    );
  } else {
    await orderRepo.updateOrderShipmentStatus(
      savedOrder.id,
      'announced',
      shipment.id,
    );
  }

  console.log(`Shipment created for order ${savedOrder.id}: ${shipment.id}`);

  return {
    shipmentId: shipment.id,
    shipmentStatus: 'announced',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an order after Stripe PaymentSheet has completed.
 *
 * The order is keyed by paymentIntentId so frontend retries cannot create
 * duplicate orders. Product price, shipping option and Stripe state are all
 * checked server-side before anything is written to Firestore.
 */
export const createOrder = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user?.uid;
    if (!firebaseUid) {
      ResponseHandler.unauthorized(
        res,
        'User not authenticated',
        'Authentication required',
      );
      return;
    }

    const userRepo = new UserRepository();
    const dbUser = await userRepo.getByFirebaseUid(firebaseUid);
    if (!dbUser) {
      ResponseHandler.notFound(
        res,
        'User not found',
        `User with UID ${firebaseUid} does not exist`,
      );
      return;
    }
    const email = dbUser.email;

    const {
      amount,
      paymentIntentId,
      productId,
      shipping,
      shippingOptionId,
      shippingWeight,
      pickupPoint,
    } = req.body;

    const deliveryType = normaliseDeliveryType(req.body);
    if (!deliveryType) {
      ResponseHandler.badRequest(
        res,
        'Invalid request',
        'deliveryType is required',
      );
      return;
    }

    const shippingOption = MVP_SHIPPING_OPTIONS[shippingOptionId];
    if (!shippingOption) {
      ResponseHandler.badRequest(
        res,
        'Invalid request',
        'Unsupported shippingOptionId',
      );
      return;
    }

    if (shippingOption.deliveryType !== deliveryType) {
      ResponseHandler.badRequest(
        res,
        'Invalid request',
        'Shipping option does not match delivery type',
      );
      return;
    }

    const orderRepo = new OrderRepository();
    const existingOrder = await orderRepo.getByPaymentIntentId(paymentIntentId);
    if (existingOrder) {
      if (existingOrder.userId !== firebaseUid) {
        ResponseHandler.forbidden(
          res,
          'Order does not belong to this user',
          'The existing order belongs to a different authenticated user',
        );
        return;
      }

      const shipmentRepo = new ShipmentRepository();
      const existingShipment = await shipmentRepo.getShipmentByOrderId(
        existingOrder.id,
      );
      const shipmentStatus =
        existingShipment?.status || existingOrder.shipmentStatus || 'pending';

      ResponseHandler.success(
        res,
        {
          orderId: existingOrder.id,
          paymentIntentId,
          paymentStatus: existingOrder.paymentStatus,
          deliveryType: existingOrder.deliveryType || deliveryType,
          deliveryMethod:
            existingOrder.deliveryMethod || shippingOption.deliveryMethod,
          shipmentStatus,
          shipmentId: existingShipment?.id || existingOrder.shipmentId,
          idempotent: true,
        },
        'Order already exists',
      );
      return;
    }

    const productRepo = new ProductRepository();
    const product = await productRepo.getById(productId);
    if (!product) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product ${productId} does not exist`,
      );
      return;
    }

    let expectedAmount: number;
    try {
      expectedAmount = productPriceToPence(product) + shippingOption.pricePence;
    } catch (err) {
      ResponseHandler.badRequest(
        res,
        'Invalid product price',
        err instanceof Error ? err.message : 'Product price is invalid',
      );
      return;
    }

    if (amount !== expectedAmount) {
      ResponseHandler.badRequest(
        res,
        'Invalid order amount',
        'Order total does not match server pricing',
      );
      return;
    }

    const paymentService = new PaymentService();
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await paymentService.getPaymentIntent(paymentIntentId);
    } catch (err) {
      ResponseHandler.badRequest(
        res,
        'Payment could not be confirmed',
        'Stripe PaymentIntent could not be retrieved',
      );
      return;
    }

    if (paymentIntent.status !== 'succeeded') {
      ResponseHandler.badRequest(
        res,
        'Payment has not completed',
        `Stripe PaymentIntent status is ${paymentIntent.status}`,
      );
      return;
    }

    if (paymentIntent.amount !== amount) {
      ResponseHandler.badRequest(
        res,
        'Invalid payment amount',
        'Stripe PaymentIntent amount does not match the order total',
      );
      return;
    }

    if (paymentIntent.currency.toLowerCase() !== 'gbp') {
      ResponseHandler.badRequest(
        res,
        'Invalid payment currency',
        'Stripe PaymentIntent currency must be gbp',
      );
      return;
    }

    if (
      paymentIntent.metadata?.firebaseUid &&
      paymentIntent.metadata.firebaseUid !== firebaseUid
    ) {
      ResponseHandler.forbidden(
        res,
        'Payment does not belong to this user',
        'PaymentIntent metadata does not match the authenticated user',
      );
      return;
    }

    const customerId = getPaymentIntentCustomerId(paymentIntent.customer);
    if (!customerId) {
      ResponseHandler.badRequest(
        res,
        'Invalid payment customer',
        'Stripe PaymentIntent is missing a customer',
      );
      return;
    }

    const paymentCustomerEmail =
      await paymentService.getCustomerEmail(customerId);
    if (
      !paymentCustomerEmail ||
      paymentCustomerEmail.toLowerCase() !== email.toLowerCase()
    ) {
      ResponseHandler.forbidden(
        res,
        'Payment does not belong to this user',
        'Stripe customer does not match the authenticated user',
      );
      return;
    }

    const deliveryMethod = shippingOption.deliveryMethod;
    const orderShipping =
      deliveryType === 'home'
        ? shipping
        : pickupPoint
          ? {
              name: pickupPoint.name,
              address: {
                line1: pickupPoint.addressLine1,
                city: pickupPoint.city,
                postal_code: pickupPoint.postalCode,
                country: pickupPoint.country || 'GB',
              },
            }
          : undefined;
    const orderPickupPoint = buildPickupPoint(pickupPoint);
    const resolvedShippingWeight =
      typeof shippingWeight === 'number' ? shippingWeight : 500;
    const { order: savedOrder, created } =
      await orderRepo.createOrderIdempotently({
        userId: firebaseUid,
        email,
        amount,
        currency: 'gbp',
        paymentIntentId,
        paymentStatus: paymentIntent.status,
        productId,
        productName: product.name,
        productSnapshot: buildProductSnapshot(product),
        shipping: orderShipping,
        deliveryType,
        deliveryMethod,
        shippingProvider: 'sendcloud',
        shippingOptionId: shippingOption.id,
        shippingOptionName: shippingOption.name,
        shippingOptionPrice: shippingOption.pricePence,
        shippingCarrier: shippingOption.carrier,
        shippingWeight: resolvedShippingWeight,
        courier: orderPickupPoint?.carrier || shippingOption.carrier,
        pickupPointId: orderPickupPoint?.id,
        pickupPoint: orderPickupPoint,
        status: 'completed',
        shipmentStatus: 'pending',
      });

    let shipmentStatus: string = savedOrder.shipmentStatus || 'pending';
    let shipmentId: string | undefined = savedOrder.shipmentId;

    if (
      created &&
      deliveryMethod === 'ship_to_home' &&
      orderShipping?.address
    ) {
      try {
        const shipmentResult = await createShipToHomeParcel(
          savedOrder,
          orderShipping,
          email,
          resolvedShippingWeight,
        );
        shipmentStatus = shipmentResult.shipmentStatus;
        shipmentId = shipmentResult.shipmentId;
      } catch (shipErr) {
        // Shipment failure must not undo the paid order. Admin can retry later.
        await orderRepo.updateOrderShipmentStatus(savedOrder.id, 'pending');
        console.error(`Shipment creation failed for order ${savedOrder.id}`);
        if (shipErr instanceof Error) {
          console.error(`Shipment error: ${shipErr.name}: ${shipErr.message}`);
        }
        shipmentStatus = 'pending';
      }
    } else if (!created) {
      const shipmentRepo = new ShipmentRepository();
      const existingShipment = await shipmentRepo.getShipmentByOrderId(
        savedOrder.id,
      );

      if (existingShipment) {
        shipmentStatus = existingShipment.status;
        shipmentId = existingShipment.id;
      }
    }

    ResponseHandler.success(
      res,
      {
        orderId: savedOrder.id,
        paymentIntentId,
        paymentStatus: paymentIntent.status,
        deliveryType,
        deliveryMethod,
        shipmentStatus,
        shipmentId,
        idempotent: !created,
      },
      created ? 'Order created successfully' : 'Order already exists',
    );
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error creating order: ${err.name}: ${err.message}`);
    } else {
      console.error('Error creating order');
    }

    ResponseHandler.internalServerError(
      res,
      'Failed to create order',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

/**
 * Returns all orders from Firestore (admin use).
 */
export const getAllOrders = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderRepo = new OrderRepository();
    const orders = await orderRepo.getAllOrders();
    ResponseHandler.success(res, { orders }, 'All orders fetched successfully');
  } catch (err) {
    console.error('Error fetching orders:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch orders',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
