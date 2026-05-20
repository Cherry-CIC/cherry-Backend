import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { ShipmentService } from '../../shipping/services/ShipmentService';
import { PaymentService } from '../../payment/services/PaymentService';
import { CheckoutShippingService } from '../../shipping/services/CheckoutShippingService';
import { DeliveryType, PickupPointSelection } from '../model/Order';
import {
  normaliseCarrier,
  resolveConfiguredPickupPointShippingMethod,
  resolveHomeShippingMethodId,
} from '../../shipping/services/shippingMethodResolver';

const checkoutShippingService = new CheckoutShippingService();

interface ResolvedOrderShipping {
  shippingMethodId: string;
  shippingMethodName?: string;
  shippingMethodPrice?: string;
  carrier?: string | null;
}

const buildPickupPointSnapshot = (
  pickupPoint: PickupPointSelection,
  carrier?: string | null,
) => ({
  pickupPoint: {
    ...pickupPoint,
    carrier: carrier || normaliseCarrier(pickupPoint.carrier),
  },
  pickupPointId: pickupPoint.id,
  pickupPointName: pickupPoint.name,
  pickupPointAddressLine1: pickupPoint.addressLine1,
  pickupPointCity: pickupPoint.city,
  pickupPointPostalCode: pickupPoint.postalCode,
  pickupPointCountry: pickupPoint.country,
  pickupPointCarrier: carrier || normaliseCarrier(pickupPoint.carrier),
});

const resolvePickupPointShipping = async (
  pickupPoint: PickupPointSelection,
  shippingAddressCountry: string,
  requestedShippingMethodId?: string,
): Promise<ResolvedOrderShipping> => {
  const configuredMethod = resolveConfiguredPickupPointShippingMethod(
    pickupPoint.carrier,
  );
  const requestedOrConfiguredMethodId = String(
    requestedShippingMethodId || configuredMethod?.id || '',
  ).trim();

  const shippingMethods = await checkoutShippingService.getDeliveryOptions({
    servicePointId: pickupPoint.id,
    country: pickupPoint.country || shippingAddressCountry,
    postalCode: pickupPoint.postalCode,
    carrier: configuredMethod?.carrier || undefined,
  });

  const selectedShippingMethod = requestedOrConfiguredMethodId
    ? shippingMethods.find(
        (method) =>
          method.id === requestedOrConfiguredMethodId ||
          method.checkoutIdentifier === requestedOrConfiguredMethodId,
      )
    : shippingMethods.length === 1
      ? shippingMethods[0]
      : undefined;

  if (!selectedShippingMethod) {
    throw new Error(
      requestedOrConfiguredMethodId
        ? 'Selected shipping method is not valid for this pickup point'
        : 'A service-point shipping method could not be resolved for this pickup point',
    );
  }

  return {
    shippingMethodId: selectedShippingMethod.id,
    shippingMethodName: selectedShippingMethod.name,
    shippingMethodPrice: selectedShippingMethod.price ?? undefined,
    carrier:
      normaliseCarrier(selectedShippingMethod.carrierCode) ||
      normaliseCarrier(selectedShippingMethod.carrierName) ||
      configuredMethod?.carrier ||
      null,
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
    const {
      amount,
      productId,
      productName,
      paymentIntentId,
      deliveryMethod,
      shippingMethodId,
      shippingCarrier,
      shippingWeight,
      shipping,
      pickupPoint,
    } = req.body;

    if (!amount) {
      ResponseHandler.badRequest(res, 'Invalid request', 'Amount is required');
      return;
    }

    const deliveryType = deliveryMethod as DeliveryType;
    let resolvedShipping: ResolvedOrderShipping;
    try {
      if (deliveryType === 'pickup_point') {
        resolvedShipping = await resolvePickupPointShipping(
          pickupPoint,
          shipping.address.country,
          shippingMethodId,
        );
      } else {
        const resolvedHomeMethodId = resolveHomeShippingMethodId(shippingMethodId);
        if (!resolvedHomeMethodId) {
          ResponseHandler.badRequest(
            res,
            'Invalid shipping method',
            'A shipping method is required for home delivery',
          );
          return;
        }

        resolvedShipping = {
          shippingMethodId: resolvedHomeMethodId,
          carrier: normaliseCarrier(shippingCarrier),
        };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('shipping method')) {
        ResponseHandler.badRequest(
          res,
          'Invalid shipping method',
          err.message,
        );
        return;
      }
      ResponseHandler.internalServerError(
        res,
        'Failed to resolve shipping method',
        err instanceof Error ? err.message : 'Unknown error',
      );
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

    const pickupPointSnapshot =
      deliveryType === 'pickup_point'
        ? buildPickupPointSnapshot(pickupPoint, resolvedShipping.carrier)
        : {};
    const orderRepo = new OrderRepository();
    const savedOrder = await orderRepo.createOrder({
      userId: firebaseUid,
      email,
      amount,
      productId,
      productName,
      deliveryType,
      shippingOptionId: resolvedShipping.shippingMethodId,
      shippingOptionName: resolvedShipping.shippingMethodName,
      shippingOptionPrice: resolvedShipping.shippingMethodPrice,
      shippingCarrier: resolvedShipping.carrier || normaliseCarrier(shippingCarrier) || undefined,
      shippingWeight,
      shipping,
      ...pickupPointSnapshot,
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

      const order = {
        ...savedOrder,
        deliveryMethod: savedOrder.deliveryType,
        shipmentId: shipment.id,
        shipmentStatus: shipment.status,
      };

      ResponseHandler.success(
        res,
        {
          orderId: savedOrder.id,
          order,
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
          order: {
            ...savedOrder,
            deliveryMethod: savedOrder.deliveryType,
            shipmentStatus: 'pending',
          },
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
