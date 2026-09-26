import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { UserProductsQuery } from '../model/UserProfile';
import { InvalidUserProductCursor } from '../services/UserProductCursor';
import { UserProfileService } from '../services/UserProfileService';

const viewerIdFrom = (req: Request): string | undefined =>
  (req as Request & { user?: { uid?: string } }).user?.uid;

export const getUserProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // Authenticated profile responses must never be shared between viewers.
  res.setHeader('Cache-Control', 'private, no-store');
  if (!viewerIdFrom(req)) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  try {
    const profile = await new UserProfileService().getUserProfile(
      req.params.userId as string,
    );
    if (!profile) {
      ResponseHandler.notFound(res, 'This profile is unavailable');
      return;
    }
    ResponseHandler.data(res, profile);
  } catch {
    // Fixed metadata only: never log UIDs, tokens, documents or raw exceptions.
    console.error('user_profile.fetch_failed');
    ResponseHandler.custom(
      res,
      503,
      false,
      'Unable to load this profile. Please try again.',
    );
  }
};

export const getUserProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // Authenticated product responses must never be shared between viewers.
  res.setHeader('Cache-Control', 'private, no-store');
  const viewerId = viewerIdFrom(req);
  if (!viewerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  try {
    const page = await new UserProfileService().getUserProducts(
      req.params.userId as string,
      viewerId,
      req.query as unknown as UserProductsQuery,
    );
    if (!page) {
      ResponseHandler.notFound(res, 'This profile is unavailable');
      return;
    }
    ResponseHandler.paginated(res, page.data, page.meta);
  } catch (error: unknown) {
    if (error instanceof InvalidUserProductCursor) {
      ResponseHandler.badRequest(res, 'Invalid cursor');
      return;
    }
    // Fixed metadata only: never log UIDs, tokens, documents or raw exceptions.
    console.error('user_products.fetch_failed');
    ResponseHandler.custom(
      res,
      503,
      false,
      'Unable to load these products. Please try again.',
    );
  }
};
