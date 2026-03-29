import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { ShipmentService } from '../../shipping/services/ShipmentService';
import { PaymentService } from '../../payment/services/PaymentService';

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
    const {
      amount,
      productId,
      productName,
      paymentIntentId,
      deliveryType,
      shippingOptionId,
      shippingOptionName,
      shippingOptionPrice,
      shippingCarrier,
      shippingWeight,
      shipping,
      pickupPoint,
    } = req.body;

    if (!amount) {
      ResponseHandler.badRequest(res, 'Invalid request', 'Amount is required');
      return;
    }

    const paymentService = new PaymentService();
    try {
      await paymentService.verifySucceededPaymentIntentForUser(
        firebaseUid,
        paymentIntentId,
        amount,
      );
    } catch (err) {
      ResponseHandler.badRequest(
        res,
        'Payment verification failed',
        err instanceof Error ? err.message : 'Unable to verify payment',
      );
      return;
    }

    const orderRepo = new OrderRepository();
    const savedOrder = await orderRepo.createOrder({
      userId: firebaseUid,
      email,
      amount,
      productId,
      productName,
      deliveryType,
      shippingOptionId,
      shippingOptionName,
      shippingOptionPrice,
      shippingCarrier,
      shippingWeight,
      shipping,
      pickupPoint,
      paymentIntentId,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'completed',
    });

    const shipmentService = new ShipmentService();

    try {
      const { shipment, sendcloudParcel } =
        await shipmentService.createShipmentForPaidOrder(savedOrder);

      await orderRepo.updateOrder(savedOrder.id, {
        shipmentId: shipment.id,
        shipmentStatus: shipment.status,
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
