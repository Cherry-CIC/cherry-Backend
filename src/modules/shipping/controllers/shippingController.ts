import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { SendcloudService } from '../services/SendcloudService';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { CheckoutShippingService } from '../services/CheckoutShippingService';
import { ShipmentService } from '../services/ShipmentService';
import { mapSendcloudStatusToShipmentStatus } from '../utils/statusMapper';
import { sendcloudWebhookValidator } from '../validators/shippingValidator';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { PostcodeLookupService } from '../services/postcode/PostcodeLookupService';

const checkoutShippingService = new CheckoutShippingService();
const shipmentService = new ShipmentService();
const postcodeLookupService = new PostcodeLookupService();
const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;

export const createShipment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { orderId, weight, shippingMethodId } = req.body;

    if (!orderId) {
      ResponseHandler.badRequest(res, 'Invalid request', 'orderId is required');
      return;
    }

    const orderRepo = new OrderRepository();
    const order = await orderRepo.getOrderById(orderId);

    if (!order) {
      ResponseHandler.notFound(
        res,
        'Order not found',
        `Order ${orderId} does not exist`,
      );
      return;
    }

    if (!order.shipping) {
      ResponseHandler.badRequest(
        res,
        'No shipping info',
        'Order does not have shipping information',
      );
      return;
    }

    const orderForShipment = {
      ...order,
      shippingWeight: weight || order.shippingWeight,
      shippingOptionId: shippingMethodId
        ? String(shippingMethodId)
        : order.shippingOptionId,
    };

    const { shipment } =
      await shipmentService.createShipmentForPaidOrder(orderForShipment);

    await orderRepo.updateOrder(order.id, {
      shipmentId: shipment.id,
      shipmentStatus: shipment.status,
    });

    ResponseHandler.success(res, { shipment }, 'Shipment created successfully');
  } catch (err) {
    console.error('Error creating shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create shipment',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const createTestParcel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { parcel } = req.body as { parcel: any };
    const testParcel = {
      ...parcel,
      request_label: false,
    };
    const sendcloudService = new SendcloudService();
    const sendcloudParcel = await sendcloudService.createParcel(testParcel);

    ResponseHandler.success(
      res,
      { sendcloudParcel },
      'Test parcel created successfully',
    );
  } catch (err) {
    console.error('Error creating test parcel:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create test parcel',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getShipmentStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = requireSingleParam(req.params.orderId);
    if (!orderId) {
      ResponseHandler.badRequest(res, 'Order ID is required');
      return;
    }

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(
        res,
        'Shipment not found',
        `No shipment found for order ${orderId}`,
      );
      return;
    }

    if (shipment.sendcloudId) {
      try {
        const sendcloudService = new SendcloudService();
        const parcel = await sendcloudService.getParcel(shipment.sendcloudId);
        const status = mapSendcloudStatusToShipmentStatus(parcel.status?.message);

        await shipmentRepo.updateShipment(shipment.id, {
          status,
          trackingNumber: parcel.tracking_number,
          trackingUrl: parcel.tracking_url,
        });

        shipment.status = status;
        shipment.trackingNumber = parcel.tracking_number;
        shipment.trackingUrl = parcel.tracking_url;
      } catch (sendcloudErr) {
        console.error('Error fetching from Sendcloud:', sendcloudErr);
      }
    }

    ResponseHandler.success(
      res,
      { shipment },
      'Shipment retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipment',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getShippingLabel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = requireSingleParam(req.params.orderId);
    if (!orderId) {
      ResponseHandler.badRequest(res, 'Order ID is required');
      return;
    }

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(
        res,
        'Shipment not found',
        `No shipment found for order ${orderId}`,
      );
      return;
    }

    if (!shipment.sendcloudId) {
      ResponseHandler.badRequest(
        res,
        'No Sendcloud ID',
        'Shipment does not have a Sendcloud parcel ID',
      );
      return;
    }

    const sendcloudService = new SendcloudService();
    const labelUrl = await sendcloudService.getLabelUrl(shipment.sendcloudId);

    if (!labelUrl) {
      ResponseHandler.notFound(
        res,
        'Label not found',
        'Label URL is not available',
      );
      return;
    }

    await shipmentRepo.updateShipment(shipment.id, { labelUrl });

    ResponseHandler.success(
      res,
      {
        labelUrl,
        trackingNumber: shipment.trackingNumber,
        orderId: shipment.orderId,
      },
      'Label retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching label:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch label',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getShippingMethods = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sendcloudService = new SendcloudService();
    const methods = await sendcloudService.getShippingMethods();

    ResponseHandler.success(
      res,
      { methods },
      'Shipping methods retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching shipping methods:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipping methods',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getCheckoutShippingOptions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { servicePointId, country, postalCode, isReturn } =
      req.query as Record<string, string>;

    const shippingMethods = await checkoutShippingService.getDeliveryOptions({
      servicePointId,
      country,
      postalCode,
      isReturn: isReturn === undefined ? undefined : String(isReturn).toLowerCase() === 'true',
      carrier: ENFORCED_CARRIER,
    });

    ResponseHandler.success(
      res,
      { shippingMethods },
      'Shipping methods retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching checkout shipping options:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipping methods',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getPickupPoints = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { country, address, radius } =
      req.query as Record<string, string>;

    const pickupPoints = await checkoutShippingService.getPickupPoints({
      country,
      address,
      radius: radius ? Number(radius) : undefined,
      carrier: ENFORCED_CARRIER,
    });

    ResponseHandler.success(
      res,
      { pickupPoints },
      'Pickup points retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching pickup points:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch pickup points',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const cancelShipment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = requireSingleParam(req.params.orderId);
    if (!orderId) {
      ResponseHandler.badRequest(res, 'Order ID is required');
      return;
    }

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(
        res,
        'Shipment not found',
        `No shipment found for order ${orderId}`,
      );
      return;
    }

    if (!shipment.sendcloudId) {
      ResponseHandler.badRequest(
        res,
        'No Sendcloud ID',
        'Shipment does not have a Sendcloud parcel ID',
      );
      return;
    }

    const sendcloudService = new SendcloudService();
    await sendcloudService.cancelParcel(shipment.sendcloudId);
    await shipmentRepo.updateShipment(shipment.id, { status: 'cancelled' });

    ResponseHandler.success(
      res,
      { orderId },
      'Shipment cancelled successfully',
    );
  } catch (err) {
    console.error('Error cancelling shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to cancel shipment',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const handleSendcloudWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { error, value } = sendcloudWebhookValidator.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      ResponseHandler.badRequest(
        res,
        'Invalid webhook payload',
        error.details[0].message,
      );
      return;
    }

    const { action, parcel, timestamp } = value;

    console.log('Sendcloud webhook received:', {
      action,
      parcelId: parcel?.id,
      timestamp,
    });

    if (action === 'parcel_status_changed' && parcel) {
      const shipmentRepo = new ShipmentRepository();
      const shipment = await shipmentRepo.getShipmentBySendcloudId(parcel.id);

      if (shipment) {
        const status = mapSendcloudStatusToShipmentStatus(parcel.status?.message);

        await shipmentRepo.updateShipment(shipment.id, {
          status,
          trackingNumber: parcel.tracking_number,
          trackingUrl: parcel.tracking_url,
        });

        const orderRepo = new OrderRepository();
        await orderRepo.updateOrder(shipment.orderId, {
          shipmentStatus: status,
          shipmentId: shipment.id,
        });

        console.log(`Updated shipment ${shipment.id} to status: ${status}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const getAllShipments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { status } = req.query;

    const shipmentRepo = new ShipmentRepository();
    const shipments = await shipmentRepo.getAllShipments(status as string);

    ResponseHandler.success(
      res,
      { shipments, count: shipments.length },
      'Shipments retrieved successfully',
    );
  } catch (err) {
    console.error('Error fetching shipments:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipments',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const validatePostcode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { postcode } = req.query as { postcode: string };
    const result = await postcodeLookupService.validatePostcode(postcode);

    if (!result) {
      ResponseHandler.badRequest(
        res,
        'Invalid postcode',
        'Postcode could not be validated',
      );
      return;
    }

    ResponseHandler.success(
      res,
      { postcode: result },
      'Postcode validated successfully',
    );
  } catch (err) {
    console.error('Error validating postcode:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to validate postcode',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
