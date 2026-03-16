import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const categorySchema = Joi.object({
    name: Joi.string().min(2).max(100).required()
        .messages({
            'string.base': `"name" should be a type of 'text'`,
            'string.empty': `"name" cannot be empty`,
            'string.min': `"name" should have at least {#limit} characters`,
            'string.max': `"name" should have at most {#limit} characters`,
            'any.required': `"name" is required`,
        }),

    imageUrl: Joi.string().uri().required()
        .messages({
            'string.base': `"imageUrl" should be a type of 'text'`,
            'string.uri': `"imageUrl" should be a valid URL`,
            'any.required': `"imageUrl" is required`,
        })
});

export const categoryUpdateSchema = Joi.object({
    name: Joi.string().min(2).max(100).optional()
        .messages({
            'string.base': `"name" should be a type of 'text'`,
            'string.min': `"name" should have at least {#limit} characters`,
            'string.max': `"name" should have at most {#limit} characters`,
        }),

    imageUrl: Joi.string().uri().optional()
        .messages({
            'string.base': `"imageUrl" should be a type of 'text'`,
            'string.uri': `"imageUrl" should be a valid URL`,
        })
});

export function validateCategory(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = categorySchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}

export function validateCategoryUpdate(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = categoryUpdateSchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}