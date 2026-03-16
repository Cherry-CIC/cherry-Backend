import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { ResponseHandler } from '../utils/responseHandler';

export const validateRequest = (schema: Schema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const { error } = schema.validate(req.body);
        if (error) {
            ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
            return;
        }
        next();
    };
};
