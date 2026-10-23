import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import {
  FulfillmentJobBusyError,
  OrderRepository,
  PaymentOrderMismatchError,
  PendingOrderUnavailableError,
} from '../repositories/OrderRepository';
import { PaymentService } from '../../payment/services/PaymentService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { Shipment } from '../../shipping/models/Shipment';
import { Order, OrderDisputeReason } from '../model/Order';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { DisputeRepository } from '../../../disputes/DisputeRepository';
import { DisputeSubmissionError } from '../../../disputes/Dispute';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';
import { scheduleFulfillmentRecovery } from '../services/FulfillmentRecovery';

const getDeliveryState = (
  order: Order,
  shipment?: Shipment | null,
):
  | 'pending'
  | 'preparing'
  | 'shipped'
  | 'out_for_delivery'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'disputed'
  | 'delivered'
  | 'failed'
  | 'cancelled' => {
  if (order.buyerDisputeStatus) {
    return 'disputed';
  }

  if (order.buyerConfirmedReceived) {
    return 'confirmed';
  }

  if (order.status === 'delivered') {
    return 'awaiting_confirmation';
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
    | 'awaiting_confirmation'
    | 'confirmed'
    | 'disputed'
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
    case 'awaiting_confirmation':
      return 'Awaiting your confirmation';
    case 'confirmed':
      return 'Confirmed';
    case 'disputed':
      return 'Disputed';
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

const canBuyerConfirmReceived = (order: Order): boolean => {
  if (order.buyerConfirmedReceived || order.buyerDisputeStatus) {
    return false;
  }

  return order.status === 'delivered' || order.shipmentStatus === 'delivered';
};

const DISPUTE_REASONS: OrderDisputeReason[] = [
  'wrong_item',
  'item_not_as_described',
  'item_arrived_damaged',
  'something_else',
];

const parseDisputeReason = (value: unknown): OrderDisputeReason | null => {
  if (typeof value !== 'string') {
    return null;
  }

  return DISPUTE_REASONS.includes(value as OrderDisputeReason)
    ? (value as OrderDisputeReason)
    : null;
};

const mapOrderForClient = (order: Order, shipment?: Shipment | null) => {
  const deliveryState = getDeliveryState(order, shipment);

  return {
    ...order,
    paymentState: 'paid' as const,
    deliveryState,
    deliveryLabel: getDeliveryLabel(deliveryState),
    // Buyers can raise a dispute until this time; null once the hold has ended.
    disputeWindowEndsAt:
      order.payoutStatus === 'held' && !order.buyerConfirmedReceived
        ? (order.releaseAt ?? null)
        : null,
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

    const { orderId, paymentIntentId } = req.body;

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

    if (orderId !== verifiedPayment.orderId) {
      ResponseHandler.badRequest(
        res,
        'Order does not match payment',
        'The order differs from the paid checkout',
      );
      return;
    }

    const orderRepo = new OrderRepository();
    const pendingOrder = await orderRepo.getOrderById(orderId);
    if (!pendingOrder) {
      ResponseHandler.notFound(res, 'Pending order not found');
      return;
    }

    let savedOrder;
    try {
      savedOrder = await orderRepo.finalizePendingOrder(
        orderId,
        paymentIntentId,
        {
          userId: verifiedPayment.firebaseUid,
          sellerId: verifiedPayment.sellerId,
          charityId: verifiedPayment.charityId,
          productId: verifiedPayment.productId,
          shippingMethodId: verifiedPayment.shippingMethodId,
          shippingMethodName: verifiedPayment.shippingMethodName,
          pickupPointId: verifiedPayment.pickupPointId,
          destinationCountry: verifiedPayment.destinationCountry,
          destinationPostalCode: verifiedPayment.destinationPostalCode,
          shippingCarrier: verifiedPayment.shippingCarrier,
          shippingWeight: verifiedPayment.shippingWeight,
          productAmount: verifiedPayment.productAmount,
          shippingFee: verifiedPayment.shippingFee,
          securityFee: verifiedPayment.securityFee,
          totalAmount: verifiedPayment.totalAmount,
          currency: verifiedPayment.currency,
        },
      );
    } catch (err) {
      if (err instanceof PaymentOrderMismatchError) {
        await paymentService.refundUnavailablePayment(orderId, paymentIntentId);
        res.status(409).json({
          success: false,
          code: 'PAYMENT_REFUNDED',
          message: 'Order verification failed; the payment has been refunded',
          data: { orderId, paymentStatus: 'refunded' },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (err instanceof PendingOrderUnavailableError) {
        await paymentService.refundUnavailablePayment(orderId, paymentIntentId);
        res.status(409).json({
          success: false,
          code: 'PAYMENT_REFUNDED',
          message: 'Checkout expired; the payment has been refunded',
          data: { orderId, paymentStatus: 'refunded' },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (
        err instanceof Error &&
        err.message === 'PaymentIntent has already been used'
      ) {
        ResponseHandler.conflict(res, 'Order already exists', err.message);
        return;
      }
      if (
        err instanceof Error &&
        [
          'Product is out of stock',
          'Product is not available',
          'Pending order has expired',
          'Pending order is no longer payable',
          'Reserved product is no longer available',
        ].includes(err.message)
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

    try {
      const fulfillment =
        await new OrderFulfillmentService().processPaidOrder(savedOrder.id);
      if (!fulfillment.shipment) {
        throw new Error(
          `Fulfillment completed without a shipment for order ${savedOrder.id}`,
        );
      }

      ResponseHandler.success(
        res,
        {
          orderId: savedOrder.id,
          shipment: fulfillment.shipment,
          sendcloudParcel: fulfillment.sendcloudParcel,
        },
        'Order and shipment created successfully',
      );
      return;
    } catch (err) {
      if (!(err instanceof FulfillmentJobBusyError)) {
        console.error('Order fulfillment is pending retry:', err);
        await scheduleFulfillmentRecovery(savedOrder.id);
      }

      ResponseHandler.custom(
        res,
        202,
        true,
        'Order paid; fulfillment is pending retry',
        {
          orderId: savedOrder.id,
          fulfillmentStatus: 'pending',
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

export const confirmOrderReceived = async (
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
        'You can only confirm your own orders',
      );
      return;
    }

    if (!canBuyerConfirmReceived(order)) {
      ResponseHandler.conflict(
        res,
        'Order cannot be confirmed received',
        'The order is not eligible for buyer receipt confirmation',
      );
      return;
    }

    const buyerConfirmedReceivedAt = new Date();
    await orderRepo.updateOrder(order.id, {
      buyerConfirmedReceived: true,
      buyerConfirmedReceivedAt,
      status: 'delivered',
    });

    const updatedOrder = {
      ...order,
      buyerConfirmedReceived: true,
      buyerConfirmedReceivedAt,
      status: 'delivered' as const,
    };

    // The confirmation is already saved. If the release fails, the scheduled
    // expiry task still releases the order, so the buyer's request succeeds.
    try {
      const release = await orderRepo.releaseOrderForPayout(
        order.id,
        'buyer_confirmation',
      );
      if (release.status === 'released') {
        updatedOrder.payoutStatus = 'ready_for_payout';
      }
    } catch (releaseErr) {
      console.error(
        `Failed to release order ${order.id} after buyer confirmation:`,
        releaseErr,
      );
    }
    const shipment = await shipmentRepo.getShipmentByOrderId(order.id);

    ResponseHandler.success(
      res,
      { order: mapOrderForClient(updatedOrder, shipment) },
      'Order receipt confirmed',
    );
  } catch (err) {
    console.error('Error confirming order receipt:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to confirm order receipt',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const submitOrderDispute = async (
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

    const reason = parseDisputeReason(req.body?.reason);
    if (!reason) {
      ResponseHandler.badRequest(
        res,
        'Dispute reason is required',
        `Reason must be one of: ${DISPUTE_REASONS.join(', ')}`,
      );
      return;
    }

    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (message.length > 1000) {
      ResponseHandler.badRequest(
        res,
        'Dispute message is too long',
        'Message must be 1000 characters or fewer',
      );
      return;
    }

    const dispute = await new DisputeRepository().createBuyerDispute({
      orderId,
      buyerId: firebaseUid,
      reason,
      message: message || undefined,
    });
    const orderRepo = new OrderRepository();
    const order = await orderRepo.getOrderById(orderId);
    if (!order) {
      throw new Error('Order disappeared after dispute submission');
    }
    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(order.id);
    const updatedOrder = {
      ...order,
      buyerDisputeId: dispute.disputeId,
      buyerDisputeReason: dispute.reason,
      buyerDisputeStatus: 'raised' as const,
      buyerDisputeMessage: dispute.message,
      buyerDisputedAt: dispute.createdAt,
    };

    ResponseHandler.success(
      res,
      { order: mapOrderForClient(updatedOrder, shipment) },
      'Order dispute submitted',
    );
  } catch (err) {
    if (err instanceof DisputeSubmissionError) {
      switch (err.code) {
        case 'order_not_found':
          ResponseHandler.notFound(res, 'Order not found');
          return;
        case 'not_order_owner':
          ResponseHandler.forbidden(
            res,
            'Access denied',
            'You can only dispute your own orders',
          );
          return;
        case 'order_not_eligible':
          ResponseHandler.conflict(
            res,
            'Order cannot be disputed',
            'The order is not eligible for buyer dispute submission',
          );
          return;
        case 'dispute_window_closed':
          ResponseHandler.conflict(
            res,
            'Dispute window closed',
            'The period for raising a dispute on this order has ended',
          );
          return;
      }
    }
    console.error('Error submitting order dispute:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to submit order dispute',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
