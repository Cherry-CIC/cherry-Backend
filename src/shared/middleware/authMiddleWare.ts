import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseConfig';
import { ResponseHandler } from '../utils/responseHandler';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        ResponseHandler.unauthorized(res, 'Authorization header is required', 'Missing or invalid Bearer token');
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        // Try to verify as ID token first
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (idTokenError) {
            // If ID token verification fails, try custom token verification
            // Note: Custom tokens can't be directly verified, but we can create a session
            // For now, we'll accept that custom tokens need to be exchanged for ID tokens on client
            throw idTokenError;
        }
        
        (req as any).user = decodedToken;
        next();
    } catch (error) {
        ResponseHandler.unauthorized(res, 'Invalid authentication token', error instanceof Error ? error.message : 'Token verification failed');
        return;
    }
}
