import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import {
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  ReportStatus,
  ReportTargetType,
} from '../model/Report';
import { ReportRepository } from '../repositories/ReportRepository';

const safeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const createReport = async (req: Request, res: Response): Promise<void> => {
  const reporterId = (req as any).user?.uid;
  if (!reporterId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }

  const targetType = safeString(req.body?.targetType);
  const targetId = safeString(req.body?.targetId);
  const reason = safeString(req.body?.reason);
  const message = safeString(req.body?.message) || undefined;

  if (
    !targetType ||
    !REPORT_TARGET_TYPES.includes(targetType as ReportTargetType) ||
    !targetId ||
    !reason ||
    reason.length > 100 ||
    (message && message.length > 2000)
  ) {
    ResponseHandler.badRequest(res, 'Invalid report details');
    return;
  }
  if (targetType === 'user' && targetId === reporterId) {
    ResponseHandler.badRequest(res, 'You cannot report yourself');
    return;
  }

  try {
    const report = await new ReportRepository().create({
      reporterId,
      targetType: targetType as ReportTargetType,
      targetId,
      reason,
      message,
    });
    ResponseHandler.created(res, { report }, 'Report submitted');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to submit report',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listAdminReports = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const status = safeString(req.query.status);
  const targetType = safeString(req.query.targetType);
  const cursor = safeString(req.query.cursor) || undefined;
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);

  if (
    (status && !REPORT_STATUSES.includes(status as ReportStatus)) ||
    (targetType && !REPORT_TARGET_TYPES.includes(targetType as ReportTargetType)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    ResponseHandler.badRequest(res, 'Invalid report query');
    return;
  }

  try {
    const result = await new ReportRepository().list({
      status: status as ReportStatus | undefined,
      targetType: targetType as ReportTargetType | undefined,
      limit,
      cursor,
    });
    ResponseHandler.success(res, result, 'Reports fetched');
  } catch (error) {
    if (error instanceof Error && error.message === 'cursor_not_found') {
      ResponseHandler.badRequest(res, 'Report cursor was not found');
      return;
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch reports',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const getAdminReport = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const reportId = safeString(req.params.reportId);
  if (!reportId) {
    ResponseHandler.badRequest(res, 'Report ID is required');
    return;
  }
  try {
    const report = await new ReportRepository().getById(reportId);
    if (!report) {
      ResponseHandler.notFound(res, 'Report not found');
      return;
    }
    ResponseHandler.success(res, { report }, 'Report fetched');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch report',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const updateAdminReportStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const reportId = safeString(req.params.reportId);
  const status = safeString(req.body?.status);
  const note = safeString(req.body?.note) || undefined;
  const adminId = (req as any).user?.uid;
  if (
    !reportId ||
    !adminId ||
    !status ||
    !REPORT_STATUSES.includes(status as ReportStatus) ||
    (note && note.length > 2000)
  ) {
    ResponseHandler.badRequest(res, 'Invalid report status update');
    return;
  }
  try {
    const report = await new ReportRepository().updateStatus(
      reportId,
      status as ReportStatus,
      adminId,
      note,
    );
    if (!report) {
      ResponseHandler.notFound(res, 'Report not found');
      return;
    }
    ResponseHandler.success(res, { report }, 'Report updated');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to update report',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
