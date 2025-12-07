import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { SendcloudService } from '../services/SendcloudService';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';

/**
 * Create a shipment for an existing order
 * POST /api/shipping/shipment
 */
export const createShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId, weight, shippingMethodId } = req.body;

    if (!orderId) {
      ResponseHandler.badRequest(res, 'Invalid request', 'orderId is required');
      return;
    }

    // Get order details
    const orderRepo = new OrderRepository();
    const orders = await orderRepo.getAllOrders();
    const order = orders.find(o => o.id === orderId);

    if (!order) {
      ResponseHandler.notFound(res, 'Order not found', `Order ${orderId} does not exist`);
      return;
    }

    if (!order.shipping) {
      ResponseHandler.badRequest(res, 'No shipping info', 'Order does not have shipping information');
      return;
    }

    // Check if shipment already exists
    const shipmentRepo = new ShipmentRepository();
    const existingShipment = await shipmentRepo.getShipmentByOrderId(orderId);
    
    if (existingShipment) {
      ResponseHandler.badRequest(res, 'Shipment exists', 'A shipment already exists for this order');
      return;
    }

    // Create parcel in Sendcloud
    const sendcloudService = new SendcloudService();
    const parcelData: any = {
      name: order.shipping.name || 'Customer',
      address: order.shipping.address.line1,
      address_2: order.shipping.address.line2 || '',
      city: order.shipping.address.city,
      postal_code: order.shipping.address.postal_code,
      country: order.shipping.address.country || 'GB',
      email: order.email,
      order_number: order.id,
      weight: weight || 1000, // Default 1kg if not provided
    };

    // Add shipping method if provided
    if (shippingMethodId) {
      parcelData.shipment = { id: shippingMethodId };
    }

    const sendcloudParcel = await sendcloudService.createParcel(parcelData);

    // Save to Firestore
    const shipment = await shipmentRepo.createShipment({
      orderId: order.id,
      sendcloudId: sendcloudParcel.id,
      trackingNumber: sendcloudParcel.tracking_number,
      trackingUrl: sendcloudParcel.tracking_url,
      carrier: sendcloudParcel.carrier?.name,
      status: 'announced',
      labelUrl: sendcloudParcel.label?.label_printer,
      parcel: parcelData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ResponseHandler.success(res, { shipment }, 'Shipment created successfully');
  } catch (err) {
    console.error('Error creating shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create shipment',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Get shipment status by order ID
 * GET /api/shipping/shipment/:orderId
 */
export const getShipmentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(res, 'Shipment not found', `No shipment found for order ${orderId}`);
      return;
    }

    // Optionally fetch latest status from Sendcloud
    if (shipment.sendcloudId) {
      try {
        const sendcloudService = new SendcloudService();
        const parcel = await sendcloudService.getParcel(shipment.sendcloudId);

        // Update local record with latest info
        const statusMsg = parcel.status?.message?.toLowerCase() || 'pending';
        let status: any = 'en_route';
        
        if (statusMsg.includes('delivered')) status = 'delivered';
        else if (statusMsg.includes('out for delivery')) status = 'out_for_delivery';
        else if (statusMsg.includes('exception')) status = 'exception';
        else if (statusMsg.includes('cancelled')) status = 'cancelled';
        else if (statusMsg.includes('announced')) status = 'announced';

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

    ResponseHandler.success(res, { shipment }, 'Shipment retrieved successfully');
  } catch (err) {
    console.error('Error fetching shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipment',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Get shipping label URL for an order
 * GET /api/shipping/label/:orderId
 */
export const getShippingLabel = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(res, 'Shipment not found', `No shipment found for order ${orderId}`);
      return;
    }

    if (!shipment.sendcloudId) {
      ResponseHandler.badRequest(res, 'No Sendcloud ID', 'Shipment does not have a Sendcloud parcel ID');
      return;
    }

    // Fetch label URL from Sendcloud
    const sendcloudService = new SendcloudService();
    const labelUrl = await sendcloudService.getLabelUrl(shipment.sendcloudId);

    if (!labelUrl) {
      ResponseHandler.notFound(res, 'Label not found', 'Label URL is not available');
      return;
    }

    // Update shipment with label URL
    await shipmentRepo.updateShipment(shipment.id, { labelUrl });

    ResponseHandler.success(
      res,
      { 
        labelUrl,
        trackingNumber: shipment.trackingNumber,
        orderId: shipment.orderId 
      },
      'Label retrieved successfully'
    );
  } catch (err) {
    console.error('Error fetching label:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch label',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Get available shipping methods
 * GET /api/shipping/methods
 */
export const getShippingMethods = async (req: Request, res: Response): Promise<void> => {
  try {
    const sendcloudService = new SendcloudService();
    const methods = await sendcloudService.getShippingMethods();

    ResponseHandler.success(res, { methods }, 'Shipping methods retrieved successfully');
  } catch (err) {
    console.error('Error fetching shipping methods:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipping methods',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Cancel a shipment
 * POST /api/shipping/cancel/:orderId
 */
export const cancelShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    const shipmentRepo = new ShipmentRepository();
    const shipment = await shipmentRepo.getShipmentByOrderId(orderId);

    if (!shipment) {
      ResponseHandler.notFound(res, 'Shipment not found', `No shipment found for order ${orderId}`);
      return;
    }

    if (!shipment.sendcloudId) {
      ResponseHandler.badRequest(res, 'No Sendcloud ID', 'Shipment does not have a Sendcloud parcel ID');
      return;
    }

    // Cancel in Sendcloud
    const sendcloudService = new SendcloudService();
    await sendcloudService.cancelParcel(shipment.sendcloudId);

    // Update status locally
    await shipmentRepo.updateShipment(shipment.id, { status: 'cancelled' });

    ResponseHandler.success(res, { orderId }, 'Shipment cancelled successfully');
  } catch (err) {
    console.error('Error cancelling shipment:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to cancel shipment',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Webhook handler for Sendcloud status updates
 * POST /api/shipping/webhook
 */
export const handleSendcloudWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { action, parcel, timestamp } = req.body;

    console.log('Sendcloud webhook received:', { action, parcelId: parcel?.id, timestamp });

    if (action === 'parcel_status_changed' && parcel) {
      const shipmentRepo = new ShipmentRepository();
      const shipment = await shipmentRepo.getShipmentBySendcloudId(parcel.id);

      if (shipment) {
        // Map Sendcloud status to our status
        const statusMsg = parcel.status?.message?.toLowerCase() || '';
        let status: any = 'en_route';

        if (statusMsg.includes('delivered')) status = 'delivered';
        else if (statusMsg.includes('out for delivery')) status = 'out_for_delivery';
        else if (statusMsg.includes('exception')) status = 'exception';
        else if (statusMsg.includes('cancelled')) status = 'cancelled';
        else if (statusMsg.includes('announced')) status = 'announced';

        await shipmentRepo.updateShipment(shipment.id, {
          status,
          trackingNumber: parcel.tracking_number,
          trackingUrl: parcel.tracking_url,
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
export const getAllShipments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;

    const shipmentRepo = new ShipmentRepository();
    const shipments = await shipmentRepo.getAllShipments(status as string);

    ResponseHandler.success(res, { shipments, count: shipments.length }, 'Shipments retrieved successfully');
  } catch (err) {
    console.error('Error fetching shipments:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipments',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};