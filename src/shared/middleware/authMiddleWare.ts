import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseConfig';
import { ResponseHandler } from '../utils/responseHandler';
import { isAccountRestricted } from '../../modules/account-deletion/access';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ResponseHandler.unauthorized(res, 'Authorisation header is required');
    return;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(authHeader.slice(7), true);
    if (typeof decodedToken.uid !== 'string' || !decodedToken.uid) {
      throw new Error('Missing account identity');
    }
  } catch {
    ResponseHandler.unauthorized(res, 'Invalid authentication token');
    return;
  }
  try {
    if (await isAccountRestricted(decodedToken.uid)) {
      ResponseHandler.forbidden(
        res,
        'Account deletion has been requested',
        'ACCOUNT_DELETION_PENDING',
      );
      return;
    }
  } catch {
    ResponseHandler.custom(
      res,
      503,
      false,
      'Account access could not be verified',
    );
    return;
  }
  (req as any).user = decodedToken;
  next();
}
