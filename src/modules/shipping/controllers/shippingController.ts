import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { SendcloudService } from '../services/SendcloudService';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { OrderRepository } from '../../order/repositories/OrderRepository';
import { CheckoutShippingService } from '../services/CheckoutShippingService';
import { mapSendcloudStatusToShipmentStatus } from '../utils/statusMapper';
import { sendcloudWebhookValidator } from '../validators/shippingValidator';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { PostcodeLookupService } from '../services/postcode/PostcodeLookupService';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PostageSizeRepository } from '../../postage-sizes/repositories/PostageSizeRepository';

const checkoutShippingService = new CheckoutShippingService();
const postcodeLookupService = new PostcodeLookupService();
const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;

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


export const getCheckoutShippingOptions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { productId, servicePointId, country, postalCode, isReturn } =
      req.query as Record<string, string>;

    const product = await new ProductRepository().getById(productId);
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
        'The product must have a postage size',
      );
      return;
    }

    const postageSize = await new PostageSizeRepository().getById(
      product.postageSize,
    );
    if (!postageSize) {
      ResponseHandler.badRequest(
        res,
        'Invalid product postage size',
        `Postage size ${product.postageSize} does not exist`,
      );
      return;
    }

    const shippingMethods = await checkoutShippingService.getDeliveryOptions({
      servicePointId,
      country,
      postalCode,
      weightGrams: postageSize.weight,
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
          status:
            status === 'delivered'
              ? 'delivered'
              : status === 'cancelled'
                ? 'cancelled'
                : status === 'exception'
                  ? 'failed'
                  : status === 'pending' || status === 'announced'
                    ? 'shipment_created'
                    : 'shipped',
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
