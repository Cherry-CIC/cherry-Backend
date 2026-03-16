import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../utils/responseHandler';

/**
 * Middleware to check if the authenticated user has admin privileges.
 * This middleware must be used AFTER authMiddleware.
 * 
 * Admin privileges are determined by checking the 'admin' custom claim
 * on the Firebase user token. To set this claim for a user, use:
 * 
 * admin.auth().setCustomUserClaims(uid, { admin: true })
 * 
 * @param req - Express request object (expects req.user to be set by authMiddleware)
 * @param res - Express response object
 * @param next - Express next function
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const user = (req as any).user;

        if (!user) {
            ResponseHandler.unauthorized(res, 'Authentication required', 'No user found in request');
            return;
        }

        // Check for admin custom claim
        if (user.admin === true) {
            next();
            return;
        }

        // If no admin claim, deny access
        ResponseHandler.forbidden(res, 'Admin access required', 'User does not have admin privileges');
    } catch (error) {
        console.error('Admin middleware error:', error);
        ResponseHandler.internalServerError(
            res,
            'Authorization check failed',
            error instanceof Error ? error.message : 'Unknown error'
        );
    }
}
