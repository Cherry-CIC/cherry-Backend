import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { requireSingleParam } from '../../../shared/utils/requestParam';
import { AdminShippingEmailService } from '../services/AdminShippingEmailService';

export const resendAdminSellerShippingEmail = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const orderId = requireSingleParam(req.params.orderId);
  if (!orderId) {
    ResponseHandler.badRequest(res, 'Order ID is required');
    return;
  }

  try {
    const result = await new AdminShippingEmailService().resendSellerEmail(
      orderId,
    );
    ResponseHandler.success(res, result, 'Seller shipping email resent');
  } catch (error) {
    console.error(`Error resending seller email for ${orderId}:`, error);
    ResponseHandler.internalServerError(
      res,
      'Failed to resend seller shipping email',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
};
