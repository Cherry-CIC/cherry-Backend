import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserBlockRepository } from '../repositories/UserBlockRepository';
import { CharityBlockRepository } from '../repositories/CharityBlockRepository';

const safeTargetId = (
  value: unknown,
  disallowed: readonly string[] = ['.', '..'],
): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed &&
    trimmed.length <= 128 &&
    !disallowed.includes(trimmed) &&
    !/[\/\\\x00-\x1f\x7f-\x9f]/.test(trimmed)
    ? trimmed
    : null;
};

const safeUserId = (value: unknown): string | null =>
  safeTargetId(value, ['.', '..', 'deleted_user']);

const safeCharityId = (value: unknown): string | null => safeTargetId(value);

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

export const blockCharity = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  const blockedCharityId = safeCharityId(req.params.charityId);
  if (!blockerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  if (!blockedCharityId) {
    ResponseHandler.badRequest(res, 'Invalid charity to block');
    return;
  }
  try {
    const block = await new CharityBlockRepository().block(
      blockerId,
      blockedCharityId,
    );
    ResponseHandler.success(res, { block }, 'Charity blocked');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to block charity',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const unblockCharity = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  const blockedCharityId = safeCharityId(req.params.charityId);
  if (!blockerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  if (!blockedCharityId) {
    ResponseHandler.badRequest(res, 'Invalid charity to unblock');
    return;
  }
  try {
    await new CharityBlockRepository().unblock(blockerId, blockedCharityId);
    ResponseHandler.success(res, null, 'Charity unblocked');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to unblock charity',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};

export const listBlockedCharities = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const blockerId = (req as any).user?.uid;
  if (!blockerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  try {
    const blocks = await new CharityBlockRepository().listBlockedCharities(
      blockerId,
    );
    ResponseHandler.success(res, { blocks }, 'Blocked charities fetched');
  } catch (error) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch blocked charities',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
