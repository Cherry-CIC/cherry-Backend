import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { isLockerPushEnabled } from '../lockerPushConfig';
import { PushDeviceLimitError, PushDeviceRepository, PushProfileMissingError } from '../repositories/PushDeviceRepository';

export async function registerPushDevice(req: Request, res: Response): Promise<void> {
  if (!isLockerPushEnabled()) {
    ResponseHandler.custom(res, 503, false, 'Collection notifications are not available yet');
    return;
  }
  try {
    await new PushDeviceRepository().register((req as any).user.uid, req.body.token, req.body.platform);
    ResponseHandler.success(res, undefined, 'Notification device registered');
  } catch (error) {
    if (error instanceof PushProfileMissingError) {
      ResponseHandler.notFound(res, 'Buyer profile not found');
      return;
    }
    if (error instanceof PushDeviceLimitError) {
      ResponseHandler.custom(res, 429, false, 'Notification device limit reached');
      return;
    }
    ResponseHandler.internalServerError(res, 'Could not register notification device');
  }
}

export async function removePushDevice(req: Request, res: Response): Promise<void> {
  try {
    await new PushDeviceRepository().remove((req as any).user.uid, req.body.token);
    ResponseHandler.success(res, undefined, 'Notification device removed');
  } catch {
    ResponseHandler.internalServerError(res, 'Could not remove notification device');
  }
}
