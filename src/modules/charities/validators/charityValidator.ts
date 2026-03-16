import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const charitySchema = Joi.object({
    name: Joi.string().min(2).max(100).required()
        .messages({
            'string.base': `"name" should be a type of 'text'`,
            'string.empty': `"name" cannot be empty`,
            'string.min': `"name" should have at least {#limit} characters`,
            'string.max': `"name" should have at most {#limit} characters`,
            'any.required': `"name" is required`,
        }),

    description: Joi.string().min(10).max(500).required()
        .messages({
            'string.base': `"description" should be a type of 'text'`,
            'string.empty': `"description" cannot be empty`,
            'string.min': `"description" should have at least {#limit} characters`,
            'string.max': `"description" should have at most {#limit} characters`,
            'any.required': `"description" is required`,
        }),

    imageUrl: Joi.string().uri().required()
        .messages({
            'string.base': `"imageUrl" should be a type of 'text'`,
            'string.uri': `"imageUrl" should be a valid URL`,
            'any.required': `"imageUrl" is required`,
        }),

    website: Joi.string().uri().optional()
        .messages({
            'string.base': `"website" should be a type of 'text'`,
            'string.uri': `"website" should be a valid URL`,
        })
});

export const charityUpdateSchema = Joi.object({
    name: Joi.string().min(2).max(100).optional()
        .messages({
            'string.base': `"name" should be a type of 'text'`,
            'string.min': `"name" should have at least {#limit} characters`,
            'string.max': `"name" should have at most {#limit} characters`,
        }),

    description: Joi.string().min(10).max(500).optional()
        .messages({
            'string.base': `"description" should be a type of 'text'`,
            'string.min': `"description" should have at least {#limit} characters`,
            'string.max': `"description" should have at most {#limit} characters`,
        }),

    imageUrl: Joi.string().uri().optional()
        .messages({
            'string.base': `"imageUrl" should be a type of 'text'`,
            'string.uri': `"imageUrl" should be a valid URL`,
        }),

    website: Joi.string().uri().optional()
        .messages({
            'string.base': `"website" should be a type of 'text'`,
            'string.uri': `"website" should be a valid URL`,
        })
});

export function validateCharity(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = charitySchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}

export function validateCharityUpdate(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = charityUpdateSchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}