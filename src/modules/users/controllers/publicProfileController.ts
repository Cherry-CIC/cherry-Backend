import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { PublicProfileQuery } from '../model/PublicProfile';
import { InvalidPublicProfileCursor } from '../services/PublicProfileCursor';
import { ServiceFactory } from '../services/ServiceFactory';

export const getPublicProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  // Authenticated profile responses must never be shared between viewers.
  res.setHeader('Cache-Control', 'private, no-store');
  const viewerId = (req as Request & { user?: { uid?: string } }).user?.uid;
  if (!viewerId) {
    ResponseHandler.unauthorized(res, 'Authentication required');
    return;
  }
  try {
    const page =
      await ServiceFactory.getPublicProfileService().getPublicProfile(
        req.params.userId as string,
        viewerId,
        req.query as unknown as PublicProfileQuery,
      );
    if (!page) {
      ResponseHandler.notFound(res, 'This profile is unavailable');
      return;
    }
    ResponseHandler.paginated(res, page.data, page.meta);
  } catch (error: unknown) {
    if (error instanceof InvalidPublicProfileCursor) {
      ResponseHandler.badRequest(res, 'Invalid cursor');
      return;
    }
    // Fixed metadata only: never log UIDs, tokens, documents or raw exceptions.
    console.error('public_profile.fetch_failed');
    ResponseHandler.custom(
      res,
      503,
      false,
      'Unable to load this profile. Please try again.',
    );
  }
};
