import { Request, Response } from 'express';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { OrderRepository } from '../repositories/OrderRepository';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { firestore } from '../../../shared/config/firebaseConfig';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePage = (req: Request): { limit: number; cursor?: string } => {
  const requested = Number(req.query.limit ?? DEFAULT_LIMIT);
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  const encodedCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  if (!encodedCursor) return { limit: requested };
  try {
    const cursor = Buffer.from(encodedCursor, 'base64url').toString('utf8');
    if (!cursor) throw new Error('empty cursor');
    return { limit: requested, cursor };
  } catch {
    throw new Error('Invalid cursor');
  }
};

const encodeCursor = (cursor: string | null): string | null =>
  cursor ? Buffer.from(cursor, 'utf8').toString('base64url') : null;

const sendPage = <T>(res: Response, page: { items: T[]; hasMore: boolean; nextCursor: string | null; total: number }, message: string) =>
  ResponseHandler.success(res, {
    items: page.items,
    hasMore: page.hasMore,
    nextCursor: encodeCursor(page.nextCursor),
    total: page.total,
  }, message);

const pageArgs = (req: Request): [number, string?] => {
  const page = parsePage(req);
  return [page.limit, page.cursor];
};

const isPageError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === 'Invalid cursor' || error.message.startsWith('limit must be'));

const getAttentionShipmentsPage = async (limit: number, cursor?: string) => {
  const jobs = firestore.collection('order_fulfillment_jobs');
  let query: FirebaseFirestore.Query = jobs
    .where('labelAttachmentStatus', 'in', ['pending', 'failed'])
    .limit(limit + 1);
  if (cursor) {
    const cursorDoc = await jobs.doc(cursor).get();
    if (!cursorDoc.exists) throw new Error('Invalid cursor');
    query = query.startAfter(cursorDoc);
  }
  const [snapshot, countSnapshot] = await Promise.all([
    query.get(),
    jobs.where('labelAttachmentStatus', 'in', ['pending', 'failed']).count().get(),
  ]);
  const docs = snapshot.docs.slice(0, limit);
  const shipmentRepository = new ShipmentRepository();
  const items = (await Promise.all(docs.map(async (doc) => {
    const shipment = await shipmentRepository.getShipmentByOrderId(doc.id);
    if (!shipment) return null;
    const job = doc.data();
    return {
      id: shipment.id,
      orderId: shipment.orderId,
      carrier: shipment.carrier ?? null,
      trackingNumber: shipment.trackingNumber ?? null,
      status: shipment.status,
      qrStatus: job.labelAttachmentStatus === 'failed' ? 'failed' : shipment.labelUrl ? 'available' : 'missing',
      labelAttachmentStatus: job.labelAttachmentStatus ?? 'pending',
      labelAttachmentError: job.labelAttachmentError ?? null,
      labelUrl: shipment.labelUrl ?? null,
      updatedAt: shipment.updatedAt,
    };
  }))).filter((item): item is NonNullable<typeof item> => item !== null);
  return {
    items,
    hasMore: snapshot.docs.length > limit,
    nextCursor: snapshot.docs.length > limit ? docs[docs.length - 1].id : null,
    total: countSnapshot.data().count,
  };
};

export const listAdminOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = await new OrderRepository().getAdminPage(...pageArgs(req));
    sendPage(res, {
      ...page,
      items: page.items.map((order) => ({
        id: order.id,
        productName: order.productName,
        buyerId: order.userId,
        sellerId: order.sellerId,
        amount: order.totalAmount,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        status: order.status,
        shipmentStatus: order.shipmentStatus,
        createdAt: order.createdAt,
      })),
    }, 'Orders fetched');
  } catch (error) {
    if (isPageError(error)) {
      ResponseHandler.badRequest(res, error instanceof Error ? error.message : 'Invalid page');
      return;
    }
    console.error('Error listing admin orders:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch orders',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listAdminUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = await new UserRepository().getAdminPage(...pageArgs(req));
    sendPage(res, {
      ...page,
      items: page.items.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        name: user.displayName || user.firstname || null,
        createdAt: user.createdAt ?? null,
      })),
    }, 'Users fetched');
  } catch (error) {
    if (isPageError(error)) {
      ResponseHandler.badRequest(res, error instanceof Error ? error.message : 'Invalid page');
      return;
    }
    console.error('Error listing admin users:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch users',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listAdminProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = await new ProductRepository().getAdminPage(...pageArgs(req));
    sendPage(res, {
      ...page,
      items: page.items.map((product) => ({
        id: product.id,
        name: product.name,
        sellerId: product.userId,
        charityId: product.charityId,
        price: product.price,
        donation: product.donation,
        status: product.status,
        moderationStatus: product.moderationStatus ?? null,
        hasSales: product.hasSales ?? false,
        updatedAt: product.updatedAt ?? null,
      })),
    }, 'Products fetched');
  } catch (error) {
    if (isPageError(error)) {
      ResponseHandler.badRequest(res, error instanceof Error ? error.message : 'Invalid page');
      return;
    }
    console.error('Error listing admin products:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch products',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listAdminShipments = async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.query.attention === 'true') {
      const page = await getAttentionShipmentsPage(...pageArgs(req));
      sendPage(res, page, 'Shipments needing attention fetched');
      return;
    }
    const orderRepository = new OrderRepository();
    const page = await new ShipmentRepository().getAdminPage(...pageArgs(req));
    const shipments = await Promise.all(page.items.map(async (shipment) => {
      const job = await orderRepository.getFulfillmentJob(shipment.orderId);
      const attachmentFailed = job?.labelAttachmentStatus === 'failed';
      return {
        id: shipment.id,
        orderId: shipment.orderId,
        carrier: shipment.carrier ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        status: shipment.status,
        qrStatus: attachmentFailed ? 'failed' : shipment.labelUrl ? 'available' : 'missing',
        labelAttachmentStatus: job?.labelAttachmentStatus ?? 'pending',
        labelAttachmentError: job?.labelAttachmentError ?? null,
        labelUrl: shipment.labelUrl ?? null,
        updatedAt: shipment.updatedAt,
      };
    }));
    sendPage(res, {
      ...page,
      items: shipments,
    }, 'Shipments fetched');
  } catch (error) {
    if (isPageError(error)) {
      ResponseHandler.badRequest(res, error instanceof Error ? error.message : 'Invalid page');
      return;
    }
    console.error('Error listing admin shipments:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch shipments',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
