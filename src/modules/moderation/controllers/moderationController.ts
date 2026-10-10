import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import {
  ModerationRepository,
  ProductModerationAction,
  UserModerationAction,
} from '../repositories/ModerationRepository';

const safeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const moderateProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const productId = safeString(req.params.productId);
  const action = safeString(req.body?.action);
  const reason = safeString(req.body?.reason);
  const adminId = (req as any).user?.uid;
  if (
    !productId ||
    !adminId ||
    !reason ||
    !['hide', 'restore'].includes(action || '')
  ) {
    ResponseHandler.badRequest(res, 'Invalid product moderation request');
    return;
  }
  try {
    const updated = await new ModerationRepository().moderateProduct(
      productId,
      action as ProductModerationAction,
      adminId,
      reason,
    );
    if (!updated) {
      ResponseHandler.notFound(res, 'Product not found');
      return;
    }
    ResponseHandler.success(res, { productId, action }, 'Product moderation saved');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to moderate product',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const moderateUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = safeString(req.params.userId);
  const action = safeString(req.body?.action);
  const reason = safeString(req.body?.reason);
  const adminId = (req as any).user?.uid;
  if (
    !userId ||
    !adminId ||
    !reason ||
    !['warn', 'suspend', 'restore'].includes(action || '')
  ) {
    ResponseHandler.badRequest(res, 'Invalid user moderation request');
    return;
  }
  try {
    const updated = await new ModerationRepository().moderateUser(
      userId,
      action as UserModerationAction,
      adminId,
      reason,
    );
    if (!updated) {
      ResponseHandler.notFound(res, 'User not found');
      return;
    }
    ResponseHandler.success(res, { userId, action }, 'User moderation saved');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to moderate user',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
