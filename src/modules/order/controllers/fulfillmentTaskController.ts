import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { FulfillmentJobBusyError } from '../repositories/OrderRepository';
import { isAuthorizedFulfillmentTask } from '../services/FulfillmentTaskAuth';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';

export const processFulfillmentTask = async (
  req: Request,
  res: Response,
): Promise<void> => {
  let authorized: boolean;
  try {
    authorized = await isAuthorizedFulfillmentTask(req.headers.authorization);
  } catch (err) {
    console.error('Failed to validate fulfillment task identity:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to validate fulfillment task identity',
      err instanceof Error ? err.message : 'Unknown error',
    );
    return;
  }

  if (!authorized) {
    ResponseHandler.unauthorized(res, 'Invalid fulfillment task identity');
    return;
  }

  const { orderId } = req.body ?? {};
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orderId)) {
    ResponseHandler.badRequest(res, 'A valid order ID is required');
    return;
  }

  try {
    await new OrderFulfillmentService().processPaidOrder(orderId);
    ResponseHandler.success(res, { orderId }, 'Fulfillment task completed');
  } catch (err) {
    if (err instanceof FulfillmentJobBusyError) {
      ResponseHandler.custom(
        res,
        503,
        false,
        'Fulfillment job is already processing',
        undefined,
        err.message,
      );
      return;
    }

    console.error(`Fulfillment task failed for order ${orderId}:`, err);
    ResponseHandler.internalServerError(
      res,
      'Fulfillment task failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
