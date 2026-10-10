import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserBlockRepository } from '../repositories/UserBlockRepository';

const safeUserId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed &&
    trimmed.length <= 128 &&
    !['.', '..', 'deleted_user'].includes(trimmed) &&
    !/[\/\\\x00-\x1f\x7f-\x9f]/.test(trimmed)
    ? trimmed
    : null;
};

export const blockUser = async (req: Request, res: Response): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  const blockedUserId = safeUserId(req.params.userId);
  if (!blockerId || !blockedUserId) {
    ResponseHandler.badRequest(res, 'Invalid user to block');
    return;
  }
  if (blockerId === blockedUserId) {
    ResponseHandler.badRequest(res, 'You cannot block yourself');
    return;
  }
  try {
    const block = await new UserBlockRepository().block(blockerId, blockedUserId);
    ResponseHandler.success(res, { block }, 'User blocked');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to block user',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const unblockUser = async (req: Request, res: Response): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  const blockedUserId = safeUserId(req.params.userId);
  if (!blockerId || !blockedUserId) {
    ResponseHandler.badRequest(res, 'Invalid user to unblock');
    return;
  }
  try {
    await new UserBlockRepository().unblock(blockerId, blockedUserId);
    ResponseHandler.success(res, null, 'User unblocked');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to unblock user',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listBlockedUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  if (!blockerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  try {
    const blocks = await new UserBlockRepository().listBlockedUsers(blockerId);
    ResponseHandler.success(res, { blocks }, 'Blocked users fetched');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch blocked users',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
