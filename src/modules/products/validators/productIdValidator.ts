import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export function validateProductId(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { id } = req.params;
    
    // Check if ID is provided
    if (!id) {
        ResponseHandler.badRequest(res, 'Product ID is required');
        return;
    }
    
    // Check if ID is not empty or just whitespace
    if (id.trim().length === 0) {
        ResponseHandler.badRequest(res, 'Product ID cannot be empty');
        return;
    }
    
    // Check for reasonable ID length (Firebase document IDs are typically 20 characters)
    if (id.length < 3 || id.length > 50) {
        ResponseHandler.badRequest(res, 'Product ID must be between 3 and 50 characters');
        return;
    }
    
    // Check for valid characters (alphanumeric and some special characters allowed in Firebase)
    const validIdPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validIdPattern.test(id)) {
        ResponseHandler.badRequest(res, 'Product ID contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed');
        return;
    }
    
    next();
}