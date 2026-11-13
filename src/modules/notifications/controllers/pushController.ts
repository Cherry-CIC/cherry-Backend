import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { PushDeviceLimitError, PushDeviceRepository } from '../repositories/PushDeviceRepository';
import { CollectionPushDispatcher } from '../services/CollectionPushDispatcher';

function validToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token);
}

export async function registerPushDevice(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user?.uid;
  if (!userId) { ResponseHandler.unauthorized(res); return; }
  if (process.env.COLLECTION_PUSH_ENABLED !== 'true') {
    ResponseHandler.custom(res, 503, false, 'Collection notifications are not available yet'); return;
  }
  const { token, platform } = req.body ?? {};
  if (!validToken(token) || !['ios', 'android'].includes(platform)) {
    ResponseHandler.badRequest(res, 'A valid notification token and mobile platform are required'); return;
  }
  try {
    await new PushDeviceRepository().register(userId, token, platform);
    ResponseHandler.success(res, undefined, 'Notification device registered');
  } catch (error) {
    if (error instanceof PushDeviceLimitError) {
      ResponseHandler.custom(res, 429, false, 'Notification device limit reached'); return;
    }
    // Provider errors may contain registration tokens. Do not return or log them.
    ResponseHandler.internalServerError(res, 'Could not register notification device');
  }
}

export async function removePushDevice(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user?.uid;
  if (!userId) { ResponseHandler.unauthorized(res); return; }
  const token = req.body?.token;
  if (!validToken(token)) { ResponseHandler.badRequest(res, 'A valid notification token is required'); return; }
  try {
    // Cleanup remains available when sending is switched off.
    await new PushDeviceRepository().remove(userId, token);
    ResponseHandler.success(res, undefined, 'Notification device removed');
  } catch {
    ResponseHandler.internalServerError(res, 'Could not remove notification device');
  }
}

export async function dispatchCollectionNotifications(req: Request, res: Response): Promise<void> {
  const limit = req.body?.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    ResponseHandler.badRequest(res, 'Limit must be a whole number from 1 to 100'); return;
  }
  try {
    ResponseHandler.success(res, await new CollectionPushDispatcher().runBatch(limit));
  } catch {
    ResponseHandler.internalServerError(res, 'Could not process collection notifications');
  }
}
