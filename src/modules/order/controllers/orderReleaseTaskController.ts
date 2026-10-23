import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { OrderRepository } from '../repositories/OrderRepository';
import { isAuthorizedOrderReleaseTask } from '../services/OrderReleaseTaskAuth';
import {
  OrderReleaseReconciliationService,
  parseReconcileLimit,
} from '../services/OrderReleaseReconciliationService';

// Responds with the failure itself and returns false when the caller is not the
// configured Cloud Tasks / Cloud Scheduler identity.
const authorizeCaller = async (
  req: Request,
  res: Response,
): Promise<boolean> => {
  let authorized: boolean;
  try {
    authorized = await isAuthorizedOrderReleaseTask(req.headers.authorization);
  } catch (err) {
    console.error('Failed to validate order release task identity:', err);
    ResponseHandler.internalServerError(
      res,
      'Failed to validate order release task identity',
      err instanceof Error ? err.message : 'Unknown error',
    );
    return false;
  }

  if (!authorized) {
    ResponseHandler.unauthorized(res, 'Invalid order release task identity');
    return false;
  }
  return true;
};

export const reconcileOrderReleases = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!(await authorizeCaller(req, res))) {
    return;
  }

  const limit = parseReconcileLimit(req.body?.limit);
  if (limit === null) {
    ResponseHandler.badRequest(res, 'limit must be a positive integer');
    return;
  }

  try {
    const summary = await new OrderReleaseReconciliationService().reconcile(
      new Date(),
      limit,
    );
    ResponseHandler.success(res, summary, 'Order release reconciliation done');
  } catch (err) {
    console.error('Order release reconciliation failed:', err);
    ResponseHandler.internalServerError(
      res,
      'Order release reconciliation failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const processOrderReleaseTask = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!(await authorizeCaller(req, res))) {
    return;
  }

  const { orderId } = req.body ?? {};
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orderId)) {
    ResponseHandler.badRequest(res, 'A valid order ID is required');
    return;
  }

  try {
    const result = await new OrderRepository().releaseOrderForPayout(
      orderId,
      'hold_expired',
    );

    // Anything other than "not due yet" is final for this task. A blocked order
    // is released later by buyer confirmation or the dispute resolution.
    if (result.status === 'blocked' && result.reason === 'not_due') {
      res.status(503).json({
        success: false,
        message: 'Order is not due for release yet',
        error: 'Release will be retried',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    ResponseHandler.success(res, { orderId, result }, 'Order release processed');
  } catch (err) {
    console.error(`Order release task failed for order ${orderId}:`, err);
    ResponseHandler.internalServerError(
      res,
      'Order release task failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
