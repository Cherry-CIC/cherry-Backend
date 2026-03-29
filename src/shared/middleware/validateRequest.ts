import { Request, Response, NextFunction } from 'express';
import { Schema } from 'joi';
import { ResponseHandler } from '../utils/responseHandler';

type ValidationTarget = 'body' | 'query' | 'params';

export const validateRequest = (schema: Schema, target: ValidationTarget = 'body') => {
    return (req: Request, res: Response, next: NextFunction) => {
        const { error, value } = schema.validate(req[target], {
            abortEarly: true,
            stripUnknown: true,
        });
        if (error) {
            ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
            return;
        }
        (req as any)[target] = value;
        next();
    };
};
