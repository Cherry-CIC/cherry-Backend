import { Request, Response } from 'express';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { OrderRepository } from '../repositories/OrderRepository';
import { getActiveHoldReasons } from '../services/holdReasons';
import {
  MAX_RECONCILE_LIMIT,
  OrderReleaseReconciliationService,
  parseReconcileLimit,
} from '../services/OrderReleaseReconciliationService';

const MAX_NOTE_LENGTH = 2000;

export const reconcileAdminOrderReleases = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const limit = parseReconcileLimit(req.body?.limit);
  if (limit === null) {
    ResponseHandler.badRequest(
      res,
      `limit must be an integer between 1 and ${MAX_RECONCILE_LIMIT}`,
    );
    return;
  }

  try {
    const summary = await new OrderReleaseReconciliationService().reconcile(
      new Date(),
      limit,
    );
    ResponseHandler.success(res, summary, 'Order release reconciliation done');
  } catch (err) {
    fail(res, 'reconciling order releases', err);
  }
};

const parseRequest = (
  req: Request,
  res: Response,
): { orderId: string; adminId: string; note: string } | null => {
  const orderId = requireSingleParam(req.params.orderId);
  if (!orderId) {
    ResponseHandler.badRequest(res, 'Order ID is required');
    return null;
  }

  const adminId = (req as any).user?.uid;
  if (typeof adminId !== 'string') {
    ResponseHandler.unauthorized(res, 'User not authenticated');
    return null;
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note) {
    ResponseHandler.badRequest(res, 'A note explaining the action is required');
    return null;
  }
  if (note.length > MAX_NOTE_LENGTH) {
    ResponseHandler.badRequest(
      res,
      `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    );
    return null;
  }

  return { orderId, adminId, note };
};

const fail = (res: Response, action: string, err: unknown): void => {
  console.error(`Error ${action}:`, err);
  ResponseHandler.internalServerError(
    res,
    `Failed ${action}`,
    err instanceof Error ? err.message : 'Unknown error',
  );
};

export const getAdminOrderPayout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const orderId = requireSingleParam(req.params.orderId);
  if (!orderId) {
    ResponseHandler.badRequest(res, 'Order ID is required');
    return;
  }

  try {
    const repo = new OrderRepository();
    const order = await repo.getOrderById(orderId);
    if (!order) {
      ResponseHandler.notFound(res, 'Order not found');
      return;
    }

    ResponseHandler.success(
      res,
      {
        orderId: order.id,
        payoutStatus: order.payoutStatus ?? null,
        payoutHoldReason: order.payoutHoldReason ?? null,
        payoutHoldReasons: getActiveHoldReasons(order),
        deliveredAt: order.deliveredAt ?? null,
        releaseAt: order.releaseAt ?? null,
        readyForPayoutAt: order.readyForPayoutAt ?? null,
        payoutReleaseTrigger: order.payoutReleaseTrigger ?? null,
        events: await repo.getPayoutEvents(order.id),
      },
      'Order payout state fetched',
    );
  } catch (err) {
    fail(res, 'fetching order payout state', err);
  }
};

export const holdAdminOrderPayout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsed = parseRequest(req, res);
  if (!parsed) {
    return;
  }

  try {
    const result = await new OrderRepository().placePayoutHold(parsed.orderId, {
      reason: 'admin',
      actorRole: 'admin',
      actorId: parsed.adminId,
      note: parsed.note,
    });
    if (result === 'not_applicable') {
      ResponseHandler.conflict(
        res,
        'Order has no funds on hold to hold',
        'Only orders in the held or ready_for_payout state can be held',
      );
      return;
    }
    ResponseHandler.success(
      res,
      { orderId: parsed.orderId, result },
      'Order payout hold recorded',
    );
  } catch (err) {
    fail(res, 'placing payout hold', err);
  }
};

export const unholdAdminOrderPayout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsed = parseRequest(req, res);
  if (!parsed) {
    return;
  }

  try {
    const repo = new OrderRepository();
    const result = await repo.clearPayoutHold(parsed.orderId, {
      reason: 'admin',
      actorRole: 'admin',
      actorId: parsed.adminId,
      note: parsed.note,
    });
    if (result === 'unchanged') {
      ResponseHandler.conflict(
        res,
        'No admin hold to remove',
        'Only a hold placed by an admin can be removed here',
      );
      return;
    }

    // Removing the hold must not strand an order that is already past releaseAt.
    const release = await repo.releaseOrderForPayout(
      parsed.orderId,
      'hold_expired',
    );
    ResponseHandler.success(
      res,
      { orderId: parsed.orderId, result, release },
      'Order payout hold removed',
    );
  } catch (err) {
    fail(res, 'removing payout hold', err);
  }
};

export const releaseAdminOrderPayout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsed = parseRequest(req, res);
  if (!parsed) {
    return;
  }

  try {
    const release = await new OrderRepository().releaseOrderForPayout(
      parsed.orderId,
      'admin_override',
      new Date(),
      { adminId: parsed.adminId, note: parsed.note },
    );

    if (release.status === 'blocked') {
      if (release.reason === 'order_not_found') {
        ResponseHandler.notFound(res, 'Order not found');
        return;
      }
      ResponseHandler.conflict(
        res,
        'Order cannot be released',
        `Release is blocked: ${release.reason}`,
      );
      return;
    }

    ResponseHandler.success(
      res,
      { orderId: parsed.orderId, release },
      'Order released for payout',
    );
  } catch (err) {
    fail(res, 'releasing order for payout', err);
  }
};
