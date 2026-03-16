import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const charityIdSchema = Joi.object({
    id: Joi.string().required()
        .messages({
            'string.base': `"id" should be a type of 'text'`,
            'string.empty': `"id" cannot be empty`,
            'any.required': `"id" is required`,
        })
});

export function validateCharityId(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = charityIdSchema.validate(req.params);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}