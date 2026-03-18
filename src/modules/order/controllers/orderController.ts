import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { OrderRepository } from '../repositories/OrderRepository';
import { Order } from '../model/Order';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { createShippingProvider } from '../../shipping/services/ShippingProviderFactory';
import { ShippingParcelRequest } from '../../shipping/services/ShippingProvider';

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Sendcloud parcel for a ship_to_home order and writes the
 * resulting tracking number back onto the saved order.
 * Errors are logged but swallowed so the order is never rolled back.
 */
async function createShipToHomeParcel(
  savedOrder: Order,
  shipping: any,
  email: string,
): Promise<void> {
  const shippingProvider = createShippingProvider();
  const shipmentRepo = new ShipmentRepository();
  const orderRepo = new OrderRepository();

  const parcelData: ShippingParcelRequest = {
    name: shipping.name || 'Customer',
    address: shipping.address.line1,
    address_2: shipping.address.line2 || '',
    city: shipping.address.city,
    postal_code: shipping.address.postal_code,
    country: shipping.address.country || 'GB',
    email,
    order_number: savedOrder.id,
    weight: 1000, // Default 1 kg – can be customised per product
  };

  const sendcloudParcel = await shippingProvider.createParcel(parcelData);

  const shipment = await shipmentRepo.createShipment({
    orderId: savedOrder.id,
    sendcloudId: sendcloudParcel.id,
    trackingNumber: sendcloudParcel.tracking_number,
    trackingUrl: sendcloudParcel.tracking_url,
    carrier: sendcloudParcel.carrier?.name,
    status: 'announced',
    labelUrl: sendcloudParcel.label?.label_printer,
    deliveryMethod: 'ship_to_home',
    parcel: parcelData,
  });

  if (sendcloudParcel.tracking_number) {
    await orderRepo.updateOrderTracking(
      savedOrder.id,
      sendcloudParcel.tracking_number,
      shipment.id,
    );
  }

  console.log(
    `✅ Shipment created automatically for order ${savedOrder.id}: ${shipment.id}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an Order in Firestore and, when deliveryMethod === "ship_to_home",
 * automatically creates a Sendcloud parcel.
 *
 * Expected request body (JSON):
 * {
 *   "amount": number,
 *   "productId": string,
 *   "productName": string,
 *   "deliveryMethod": "ship_to_home" | "pickup_point",
 *   "courier": string,        // e.g. "dhl"  (pickup_point only)
 *   "pickupPointId": string,  // Sendcloud service-point ID (pickup_point only)
 *   "shipping": { ... }       // Required for ship_to_home
 * }
 */
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
    const dbUser = await userRepo.getByFirebaseUid(firebaseUid);
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
      shipping,
      deliveryMethod,
      courier,
      pickupPointId,
    } = req.body;
    if (!amount) {
      ResponseHandler.badRequest(res, 'Invalid request', 'Amount is required');
      return;
    }

    const orderRepo = new OrderRepository();
    const savedOrder = await orderRepo.createOrder({
      userId: firebaseUid,
      email,
      amount,
      productId,
      productName,
      shipping,
      deliveryMethod,
      shippingProvider: deliveryMethod ? 'sendcloud' : undefined,
      courier,
      pickupPointId,
    });

    // Trigger Sendcloud only for ship_to_home; pickup_point defers parcel creation.
    if (deliveryMethod === 'ship_to_home' && shipping?.address) {
      try {
        await createShipToHomeParcel(savedOrder, shipping, email);
      } catch (shipErr) {
        // Shipment failure must NOT undo the order – admin can re-trigger manually.
        console.error(
          '⚠️ Shipment creation failed (order still saved):',
          shipErr,
        );
      }
    } else if (deliveryMethod === 'pickup_point') {
      console.log(
        `📦 Order ${savedOrder.id} flagged for pickup_point. ` +
          `courier=${courier ?? 'n/a'}, pickupPointId=${pickupPointId ?? 'n/a'}`,
      );
    } else if (!deliveryMethod && shipping?.address) {
      console.warn(
        `⚠️ Order ${savedOrder.id}: shipping address present but no deliveryMethod. ` +
          'Pass deliveryMethod="ship_to_home" to auto-create a Sendcloud parcel.',
      );
    }

    ResponseHandler.success(
      res,
      { orderId: savedOrder.id },
      'Order created successfully',
    );
  } catch (err) {
    console.error('Error creating order:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to create order',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

/**
 * Returns all orders from Firestore (admin use).
 */
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
