import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { SendcloudService } from '../../shipping/services/SendcloudService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';

/**
 * Creates a Stripe Checkout Session (renamed as an Order).
 *
 * Expected request body (JSON):
 * {
 *   "amount": number,
 *   "productId": string,
 *   "productName": string,
 *   "shipping": { ... }
 * }
 *
 * Returns the Checkout Session ID for the client to redirect via Stripe.js.
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user?.uid;
    if (!firebaseUid) {
      ResponseHandler.unauthorized(res, 'User not authenticated', 'Authentication required');
      return;
    }

    const userRepo = new UserRepository();
    const dbUser = await userRepo.getByFirebaseUid(firebaseUid);
    if (!dbUser) {
      ResponseHandler.notFound(res, 'User not found', `User with UID ${firebaseUid} does not exist`);
      return;
    }
    const email = dbUser.email;

    const { amount, productId, productName, shipping } = req.body;
    if (!amount) {
      ResponseHandler.badRequest(res, 'Invalid request', 'Amount is required');
      return;
    }

    const orderRepo = new OrderRepository();
    const savedOrder = await orderRepo.createOrder(
      firebaseUid,
      email,
      amount,
      productId,
      productName,
      shipping
    );

    // AUTO-CREATE SHIPMENT if shipping info is provided
    if (shipping && shipping.address) {
      try {
        const sendcloudService = new SendcloudService();
        const shipmentRepo = new ShipmentRepository();

        const parcelData: any = {
          name: shipping.name || 'Customer',
          address: shipping.address.line1,
          address_2: shipping.address.line2 || '',
          city: shipping.address.city,
          postal_code: shipping.address.postal_code,
          country: shipping.address.country || 'GB',
          email: email,
          order_number: savedOrder.id,
          weight: 1000, // Default 1kg - can be customized based on product
        };

        const sendcloudParcel = await sendcloudService.createParcel(parcelData);

        const shipment = await shipmentRepo.createShipment({
          orderId: savedOrder.id,
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

        console.log(`✅ Shipment created automatically for order ${savedOrder.id}: ${shipment.id}`);
      } catch (shipErr) {
        console.error('⚠️ Shipment creation failed (order still created):', shipErr);
        // Don't fail the order if shipment creation fails
      }
    }

    ResponseHandler.success(res, { orderId: savedOrder.id }, 'Order created successfully');
  } catch (err) {
    console.error('Error creating order:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create order',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};

/**
 * Placeholder endpoint to fetch all orders.
 * In a real implementation this would query a database or Stripe's API.
 * For now it returns an empty array.
 */
export const getAllOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const orderRepo = new OrderRepository();
    const orders = await orderRepo.getAllOrders();
    ResponseHandler.success(res, { orders }, 'All orders fetched successfully');
  } catch (err) {
    console.error('Error fetching orders:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch orders',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
};