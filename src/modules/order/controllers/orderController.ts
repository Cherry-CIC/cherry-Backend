import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { ShipmentService } from '../../shipping/services/ShipmentService';
import { PaymentService } from '../../payment/services/PaymentService';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { Shipment } from '../../shipping/models/Shipment';
import { Order } from '../model/Order';
import { requireSingleParam } from '../../../shared/utils/requestParam';

const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;

const getDeliveryState = (
  order: Order,
  shipment?: Shipment | null,
):
  | 'pending'
  | 'preparing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled' => {
  if (order.status === 'delivered') {
    return 'delivered';
  }

  if (order.status === 'cancelled') {
    return 'cancelled';
  }

  if (order.status === 'failed' || order.shipmentStatus === 'exception') {
    return 'failed';
  }

  if (order.shipmentStatus === 'out_for_delivery') {
    return 'out_for_delivery';
  }

  if (['en_route'].includes(order.shipmentStatus)) {
    return 'shipped';
  }

  if (
    ['shipment_created', 'shipped'].includes(order.status) ||
    ['announced'].includes(order.shipmentStatus)
  ) {
    return 'preparing';
  }

  return shipment ? 'preparing' : 'pending';
};

const getDeliveryLabel = (
  deliveryState:
    | 'pending'
    | 'preparing'
    | 'shipped'
    | 'out_for_delivery'
    | 'delivered'
    | 'failed'
    | 'cancelled',
): string => {
  switch (deliveryState) {
    case 'pending':
      return 'Shipment pending';
    case 'preparing':
      return 'Preparing shipment';
    case 'shipped':
      return 'On the way';
    case 'out_for_delivery':
      return 'Out for delivery';
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Delivery issue';
    case 'cancelled':
      return 'Cancelled';
  }
};

const buildDeliveryAddressSummary = (order: Order): string =>
  [
    order.shipping.address.line1,
    order.shipping.address.line2,
    order.shipping.address.city,
    order.shipping.address.postal_code,
    order.shipping.address.country,
  ]
    .filter(Boolean)
    .join(', ');

const mapOrderForClient = (order: Order, shipment?: Shipment | null) => {
  const deliveryState = getDeliveryState(order, shipment);

  return {
    ...order,
    paymentState: 'paid' as const,
    deliveryState,
    deliveryLabel: getDeliveryLabel(deliveryState),
    canTrack: Boolean(shipment?.trackingUrl),
    trackingNumber: shipment?.trackingNumber ?? null,
    trackingUrl: shipment?.trackingUrl ?? null,
    carrier: shipment?.carrier ?? order.shippingCarrier ?? null,
    deliveryAddressSummary: buildDeliveryAddressSummary(order),
    shipment: shipment
      ? {
          id: shipment.id,
          provider: shipment.provider ?? null,
          carrier: shipment.carrier ?? null,
          status: shipment.status,
          trackingNumber: shipment.trackingNumber ?? null,
          trackingUrl: shipment.trackingUrl ?? null,
          labelUrl: shipment.labelUrl ?? null,
          pickupPoint: shipment.pickupPoint ?? order.pickupPoint,
          createdAt: shipment.createdAt,
          updatedAt: shipment.updatedAt,
        }
      : null,
  };
};

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
    const dbUser = await userRepo.getById(firebaseUid);

    if (!dbUser) {
      ResponseHandler.notFound(
        res,
        'User not found',
        `User with UID ${firebaseUid} does not exist`,
      );
      return;
    }

    const email = dbUser.email;
    const { productId, paymentIntentId, shipping, pickupPoint } = req.body;

    const paymentService = new PaymentService();
    let verifiedPayment;
    try {
      verifiedPayment =
        await paymentService.verifySucceededPaymentIntentForUser(
          firebaseUid,
          paymentIntentId,
        );
    } catch (err) {
      ResponseHandler.badRequest(
        res,
        'Payment verification failed',
        err instanceof Error ? err.message : 'Unable to verify payment',
      );
      return;
    }

    if (productId !== verifiedPayment.productId) {
      ResponseHandler.badRequest(
        res,
        'Product does not match payment',
        'The product differs from the paid checkout',
      );
      return;
    }

    if (pickupPoint.id !== verifiedPayment.pickupPointId) {
      ResponseHandler.badRequest(
        res,
        'Pickup point does not match payment',
        'The selected pickup point differs from the paid checkout',
      );
      return;
    }

    if (
      shipping.address.country !== verifiedPayment.destinationCountry ||
      shipping.address.postal_code.replace(/\s/g, '').toUpperCase() !==
        verifiedPayment.destinationPostalCode.replace(/\s/g, '').toUpperCase()
    ) {
      ResponseHandler.badRequest(
        res,
        'Shipping destination does not match payment',
        'The shipping country or postcode differs from the paid checkout',
      );
      return;
    }

    const productRepo = new ProductRepository();
    const product = await productRepo.getById(productId);

    if (!product) {
      ResponseHandler.notFound(
        res,
        'Product not found',
        `Product with ID ${productId} does not exist`,
      );
      return;
    }

    if (!product.postageSize) {
      ResponseHandler.badRequest(
        res,
        'Product postage size is missing',
        'The product must have a postage size before an order can be created',
      );
      return;
    }

    const postageSizeRepo = new PostageSizeRepository();
    const postageSize = await postageSizeRepo.getById(product.postageSize);

    if (!postageSize) {
      ResponseHandler.badRequest(
        res,
        'Invalid product postage size',
        `Postage size ${product.postageSize} does not exist`,
      );
      return;
    }

    if (postageSize.weight !== verifiedPayment.shippingWeight) {
      ResponseHandler.badRequest(
        res,
        'Product postage size changed',
        'The product postage weight differs from the paid checkout',
      );
      return;
    }

    const normalizedPickupCarrier = String(pickupPoint?.carrier || '').toLowerCase();
    if (
      verifiedPayment.shippingCarrier !== ENFORCED_CARRIER ||
      normalizedPickupCarrier !== ENFORCED_CARRIER
    ) {
      ResponseHandler.badRequest(
        res,
        'Invalid carrier',
        `Only ${ENFORCED_CARRIER} carrier is supported`,
      );
      return;
    }

    const orderRepo = new OrderRepository();
    let savedOrder;
    try {
      savedOrder = await orderRepo.createPaidOrderAndDecrementInventory({
        userId: firebaseUid,
        email,
        productAmount: verifiedPayment.productAmount,
        shippingFee: verifiedPayment.shippingFee,
        securityFee: verifiedPayment.securityFee,
        totalAmount: verifiedPayment.totalAmount,
        currency: verifiedPayment.currency,
        productId: verifiedPayment.productId,
        productName: product.name,
        deliveryType: 'pickup_point',
        shippingOptionId: verifiedPayment.shippingMethodId,
        shippingOptionName: verifiedPayment.shippingMethodName,
        shippingCarrier: verifiedPayment.shippingCarrier,
        shippingWeight: verifiedPayment.shippingWeight,
        shipping,
        pickupPoint,
        paymentIntentId,
        paymentStatus: 'succeeded',
        shipmentStatus: 'pending',
        status: 'paid',
      });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === 'PaymentIntent has already been used'
      ) {
        ResponseHandler.conflict(res, 'Order already exists', err.message);
        return;
      }
      if (
        err instanceof Error &&
        ['Product price changed', 'Product is out of stock'].includes(err.message)
      ) {
        ResponseHandler.conflict(
          res,
          'Checkout is no longer valid',
          err.message,
        );
        return;
      }
      throw err;
    }

    const shipmentService = new ShipmentService();

    try {
      const { shipment, sendcloudParcel } =
        await shipmentService.createShipmentForPaidOrder(savedOrder);

      await orderRepo.updateOrder(savedOrder.id, {
        shipmentId: shipment.id,
        shipmentStatus: shipment.status,
        status: 'shipment_created',
      });

      ResponseHandler.success(
        res,
        {
          orderId: savedOrder.id,
          shipment,
          sendcloudParcel,
        },
        'Order and shipment created successfully',
      );
      return;
    } catch (err) {
      await orderRepo.updateOrder(savedOrder.id, {
        shipmentStatus: 'pending',
        status: 'shipment_pending',
      });

      ResponseHandler.custom(
        res,
        202,
        true,
        'Order created, shipment pending',
        {
          orderId: savedOrder.id,
          shipmentStatus: 'pending',
        },
        err instanceof Error ? err.message : 'Shipment creation failed',
      );
      return;
    }
  } catch (err) {
    console.error('Error creating order:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create order',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getMyOrders = async (
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

    const orderRepo = new OrderRepository();
    const shipmentRepo = new ShipmentRepository();
    const orders = await orderRepo.getOrdersByUserId(firebaseUid);
    const shipments = await Promise.all(
      orders.map((order) => shipmentRepo.getShipmentByOrderId(order.id)),
    );
    const enrichedOrders = orders.map((order, index) =>
      mapOrderForClient(order, shipments[index]),
    );

    ResponseHandler.success(
      res,
      { orders: enrichedOrders, count: enrichedOrders.length },
      'Orders fetched successfully',
    );
  } catch (err) {
    console.error('Error fetching user orders:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch orders',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getMyOrderById = async (
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

    const orderId = requireSingleParam(req.params.id);
    if (!orderId) {
      ResponseHandler.badRequest(res, 'Order ID is required');
      return;
    }
    const orderRepo = new OrderRepository();
    const shipmentRepo = new ShipmentRepository();
    const order = await orderRepo.getOrderById(orderId);

    if (!order) {
      ResponseHandler.notFound(
        res,
        'Order not found',
        `Order with ID ${orderId} does not exist`,
      );
      return;
    }

    if (order.userId !== firebaseUid) {
      ResponseHandler.forbidden(
        res,
        'Access denied',
        'You can only view your own orders',
      );
      return;
    }

    const shipment = await shipmentRepo.getShipmentByOrderId(order.id);

    ResponseHandler.success(
      res,
      { order: mapOrderForClient(order, shipment) },
      'Order fetched successfully',
    );
  } catch (err) {
    console.error('Error fetching user order:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch order',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
