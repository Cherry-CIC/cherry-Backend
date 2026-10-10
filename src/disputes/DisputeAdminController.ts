import { Request, Response } from 'express';
import { requireSingleParam } from '../shared/utils/requestParam';
import { ResponseHandler } from '../shared/utils/responseHandler';
import {
  AdminModerationStatus,
  DISPUTE_STATUSES,
  DisputeAdminError,
  DisputeStatus,
} from './Dispute';
import { DisputeRepository } from './DisputeRepository';

const MODERATABLE_STATUSES: AdminModerationStatus[] = [
  'in_progress',
  'resolved',
];

export const getAdminDisputeSummary = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const counts = await new DisputeRepository().getStatusCounts();
    const total = DISPUTE_STATUSES.reduce(
      (sum, status) => sum + counts[status],
      0,
    );
    ResponseHandler.success(res, { total, counts }, 'Dispute summary fetched');
  } catch (error) {
    console.error('Error fetching admin dispute summary:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch dispute summary',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listAdminDisputes = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const status = req.query.status;
  if (
    status !== undefined &&
    (typeof status !== 'string' || !DISPUTE_STATUSES.includes(status as DisputeStatus))
  ) {
    ResponseHandler.badRequest(res, 'Invalid dispute status filter');
    return;
  }

  const limitValue = req.query.limit === undefined ? '25' : req.query.limit;
  const limit = typeof limitValue === 'string' ? Number(limitValue) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    ResponseHandler.badRequest(res, 'Limit must be an integer between 1 and 100');
    return;
  }

  const cursor = req.query.cursor;
  if (cursor !== undefined && typeof cursor !== 'string') {
    ResponseHandler.badRequest(res, 'Invalid dispute cursor');
    return;
  }

  try {
    const result = await new DisputeRepository().listDisputes({
      status: status as DisputeStatus | undefined,
      limit,
      cursor,
    });
    ResponseHandler.success(res, result, 'Disputes fetched');
  } catch (error) {
    if (error instanceof DisputeAdminError && error.code === 'cursor_not_found') {
      ResponseHandler.badRequest(res, 'Dispute cursor was not found');
      return;
    }
    console.error('Error listing admin disputes:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch disputes',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const getAdminDisputeDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const disputeId = requireSingleParam(req.params.disputeId);
  if (!disputeId) {
    ResponseHandler.badRequest(res, 'Dispute ID is required');
    return;
  }

  try {
    const details = await new DisputeRepository().getDisputeDetails(disputeId);
    if (!details) {
      ResponseHandler.notFound(res, 'Dispute not found');
      return;
    }
    ResponseHandler.success(res, details, 'Dispute details fetched');
  } catch (error) {
    console.error('Error fetching admin dispute details:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch dispute details',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const getAdminDisputeDetailsByOrderId = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const orderId = requireSingleParam(req.params.orderId);
  if (!orderId) {
    ResponseHandler.badRequest(res, 'Order ID is required');
    return;
  }

  try {
    const details = await new DisputeRepository().getDisputeDetailsByOrderId(
      orderId,
    );
    if (!details) {
      ResponseHandler.notFound(res, 'Dispute not found for order');
      return;
    }
    ResponseHandler.success(res, details, 'Dispute details fetched');
  } catch (error) {
    console.error('Error fetching dispute details by order ID:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch dispute details',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const moderateAdminDispute = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const disputeId = requireSingleParam(req.params.disputeId);
  if (!disputeId) {
    ResponseHandler.badRequest(res, 'Dispute ID is required');
    return;
  }

  const status = req.body?.status;
  if (
    typeof status !== 'string' ||
    !MODERATABLE_STATUSES.includes(status as AdminModerationStatus)
  ) {
    ResponseHandler.badRequest(
      res,
      `Status must be one of: ${MODERATABLE_STATUSES.join(', ')}`,
    );
    return;
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length > 2000) {
    ResponseHandler.badRequest(res, 'Moderation note must be 2000 characters or fewer');
    return;
  }
  if (status === 'resolved' && !note) {
    ResponseHandler.badRequest(res, 'A resolution explanation is required');
    return;
  }

  const idempotencyKey = req.header('Idempotency-Key');
  if (
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    ResponseHandler.badRequest(
      res,
      'A valid Idempotency-Key header of at most 128 characters is required',
    );
    return;
  }

  const adminId = (req as any).user?.uid;
  if (typeof adminId !== 'string') {
    ResponseHandler.unauthorized(res, 'User not authenticated');
    return;
  }

  try {
    const dispute = await new DisputeRepository().moderateDispute(
      disputeId,
      adminId,
      status as AdminModerationStatus,
      note || undefined,
      idempotencyKey,
    );
    ResponseHandler.success(res, { dispute }, 'Dispute moderation saved');
  } catch (error) {
    if (error instanceof DisputeAdminError) {
      if (error.code === 'dispute_not_found') {
        ResponseHandler.notFound(res, 'Dispute not found');
        return;
      }
      if (error.code === 'invalid_status_transition') {
        ResponseHandler.conflict(res, 'Dispute cannot transition to that status');
        return;
      }
      if (error.code === 'idempotency_key_reused') {
        ResponseHandler.conflict(
          res,
          'Idempotency-Key was already used for a different request',
        );
        return;
      }
    }
    console.error('Error moderating admin dispute:', error);
    ResponseHandler.internalServerError(
      res,
      'Failed to moderate dispute',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
