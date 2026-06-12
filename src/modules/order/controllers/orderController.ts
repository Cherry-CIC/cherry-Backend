import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { ShipmentService } from '../../shipping/services/ShipmentService';
import { PaymentService } from '../../payment/services/PaymentService';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';

const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;

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
    const orders = await orderRepo.getOrdersByUserId(firebaseUid);

    ResponseHandler.success(
      res,
      { orders, count: orders.length },
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
