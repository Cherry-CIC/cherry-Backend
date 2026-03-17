import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { Shipment } from '../models/Shipment';
import { createShippingProvider } from '../services/ShippingProviderFactory';
import { ShippingParcelRequest } from '../services/ShippingProvider';

const mapShipmentStatus = (statusMessage?: string): Shipment['status'] => {
  const normalisedStatusMessage = statusMessage?.toLowerCase() || '';

  if (normalisedStatusMessage.includes('delivered')) return 'delivered';
  if (normalisedStatusMessage.includes('out for delivery'))
    return 'out_for_delivery';
  if (normalisedStatusMessage.includes('exception')) return 'exception';
  if (normalisedStatusMessage.includes('cancelled')) return 'cancelled';
  if (normalisedStatusMessage.includes('announced')) return 'announced';

  return 'en_route';
};

const parseWebhookTimestamp = (timestamp: unknown): number | null => {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === 'number') {
    return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  }

  if (typeof timestamp === 'string') {
    const numericTimestamp = Number(timestamp);

    if (!Number.isNaN(numericTimestamp)) {
      return parseWebhookTimestamp(numericTimestamp);
    }

    const parsedDate = Date.parse(timestamp);
    return Number.isNaN(parsedDate) ? null : parsedDate;
  }

  return null;
};

/**
 * Create a shipment for an existing order
 * POST /api/shipping/shipment
 */
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

    // Get order details
    const orderRepo = new OrderRepository();
    const order = await orderRepo.getById(orderId);

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

    // Check if shipment already exists
    const shipmentRepo = new ShipmentRepository();
    const existingShipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (existingShipment) {
      ResponseHandler.badRequest(
        res,
        'Shipment exists',
        'A shipment already exists for this order',
      );
      return;
    }

    // Create parcel in Sendcloud
    const shippingProvider = createShippingProvider();
    const parcelData: ShippingParcelRequest = {
      name: order.shipping.name || 'Customer',
      address: order.shipping.address.line1 || '',
      address_2: order.shipping.address.line2 || '',
      city: order.shipping.address.city || '',
      postal_code: order.shipping.address.postal_code || '',
      country: order.shipping.address.country || 'GB',
      email: order.email,
      order_number: order.id,
      weight: weight || 1000, // Default 1kg if not provided
    };

    let sendcloudParcel;

    if (order.deliveryMethod === 'pickup_point') {
      if (!order.pickupPointId) {
        ResponseHandler.badRequest(
          res,
          'Missing pickup point',
          'pickupPointId must be present on pickup_point orders before shipment creation',
        );
        return;
      }

      if (!shippingMethodId) {
        ResponseHandler.badRequest(
          res,
          'Missing shipping method',
          'shippingMethodId is required when creating a pickup_point shipment',
        );
        return;
      }

      parcelData.shipment = { id: shippingMethodId };
      parcelData.to_service_point = order.pickupPointId;
      sendcloudParcel = await shippingProvider.createParcelToServicePoint(
        parcelData,
        order.pickupPointId,
        shippingMethodId,
      );
    } else {
      if (shippingMethodId) {
        parcelData.shipment = { id: shippingMethodId };
      }

      sendcloudParcel = await shippingProvider.createParcel(parcelData);
    }

    // Save to Firestore
    const shipment = await shipmentRepo.createShipment({
      orderId: order.id,
      sendcloudId: sendcloudParcel.id,
      trackingNumber: sendcloudParcel.tracking_number,
      trackingUrl: sendcloudParcel.tracking_url,
      carrier: sendcloudParcel.carrier?.name,
      status: 'announced',
      labelUrl: sendcloudParcel.label?.label_printer,
      deliveryMethod: order.deliveryMethod || 'ship_to_home',
      pickupPointId: order.pickupPointId,
      parcel: parcelData,
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

/**
 * Get shipment status by order ID
 * GET /api/shipping/shipment/:orderId
 */
export const getShipmentStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = req.params.orderId as string;

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

    // Optionally fetch latest status from Sendcloud
    if (shipment.sendcloudId) {
      try {
        const shippingProvider = createShippingProvider();
        const parcel = await shippingProvider.getParcel(shipment.sendcloudId);

        // Update local record with latest info
        const status = mapShipmentStatus(parcel.status?.message);

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
        // Continue with local data if Sendcloud fails
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

/**
 * Get shipping label URL for an order
 * GET /api/shipping/label/:orderId
 */
export const getShippingLabel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = req.params.orderId as string;

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

    // Fetch label URL from Sendcloud
    const shippingProvider = createShippingProvider();
    const labelUrl = await shippingProvider.getLabelUrl(shipment.sendcloudId);

    if (!labelUrl) {
      ResponseHandler.notFound(
        res,
        'Label not found',
        'Label URL is not available',
      );
      return;
    }

    // Update shipment with label URL
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

/**
 * Get available shipping methods
 * GET /api/shipping/methods
 */
export const getShippingMethods = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { servicePointId } = req.query as Record<string, string>;
    const shippingProvider = createShippingProvider();
    const methods = await shippingProvider.getShippingMethods({ servicePointId });

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

/**
 * Cancel a shipment
 * POST /api/shipping/cancel/:orderId
 */
export const cancelShipment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const orderId = req.params.orderId as string;

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

    // Cancel in Sendcloud
    const shippingProvider = createShippingProvider();
    await shippingProvider.cancelParcel(shipment.sendcloudId);

    // Update status locally
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

/**
 * Webhook handler for Sendcloud status updates
 * POST /api/shipping/webhook
 */
export const handleSendcloudWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawBody = (req as any).rawBody as Buffer | string | undefined;
    const signature = req.headers['sendcloud-signature'] as string | undefined;

    if (!rawBody) {
      ResponseHandler.badRequest(
        res,
        'Missing raw webhook body',
        'Webhook signature verification requires the raw request body',
      );
      return;
    }

    if (!signature) {
      ResponseHandler.badRequest(
        res,
        'Missing Sendcloud signature header',
        'Expected "Sendcloud-Signature" header',
      );
      return;
    }

    const shippingProvider = createShippingProvider();
    if (!shippingProvider.verifyWebhookSignature(rawBody, signature)) {
      ResponseHandler.badRequest(
        res,
        'Invalid Sendcloud webhook signature',
        'Webhook signature verification failed',
      );
      return;
    }

    const { action, parcel, timestamp } = req.body;

    console.log('Sendcloud webhook received:', {
      action,
      parcelId: parcel?.id,
      timestamp,
    });

    if (action === 'parcel_status_changed' && parcel) {
      const shipmentRepo = new ShipmentRepository();
      const shipment = await shipmentRepo.getShipmentBySendcloudId(parcel.id);

      if (shipment) {
        const incomingTimestampMs = parseWebhookTimestamp(timestamp);
        const existingTimestampMs = parseWebhookTimestamp(
          shipment.lastWebhookTimestamp,
        );

        if (
          incomingTimestampMs !== null &&
          existingTimestampMs !== null &&
          incomingTimestampMs <= existingTimestampMs
        ) {
          res.status(200).json({ received: true, ignored: true });
          return;
        }

        const status = mapShipmentStatus(parcel.status?.message);

        await shipmentRepo.updateShipment(shipment.id, {
          status,
          trackingNumber: parcel.tracking_number,
          trackingUrl: parcel.tracking_url,
          lastWebhookTimestamp:
            incomingTimestampMs !== null
              ? new Date(incomingTimestampMs)
              : shipment.lastWebhookTimestamp,
        });

        console.log(`Updated shipment ${shipment.id} to status: ${status}`);

        // TODO: Send email notification to customer
        // await sendTrackingUpdateEmail(order.email, status, trackingUrl);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/**
 * Get all shipments (admin only)
 * GET /api/shipping/shipments
 */
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

/**
 * Get Sendcloud pickup points (service points) near a postcode.
 * GET /api/shipping/pickup-points?postcode=SW1A1AA&courier=dhl
 *
 * Called by the Flutter checkout screen to populate the pickup-point picker.
 */
export const getPickupPoints = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { postcode, courier } = req.query as Record<string, string>;

    if (!postcode) {
      ResponseHandler.badRequest(
        res,
        'Missing parameter',
        '"postcode" query parameter is required',
      );
      return;
    }

    const shippingProvider = createShippingProvider();
    const pickupPoints = await shippingProvider.getPickupPoints(
      postcode,
      courier,
    );

    ResponseHandler.success(
      res,
      { pickupPoints, count: pickupPoints.length },
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
