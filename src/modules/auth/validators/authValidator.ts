import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const registerSchema = Joi.object({
    email: Joi.string().email().required()
        .messages({
            'string.base': `"email" should be a type of 'text'`,
            'string.empty': `"email" cannot be empty`,
            'string.email': `"email" must be a valid email`,
            'any.required': `"email" is required`,
        }),

    password: Joi.string().min(6).required()
        .messages({
            'string.base': `"password" should be a type of 'text'`,
            'string.empty': `"password" cannot be empty`,
            'string.min': `"password" should have at least {#limit} characters`,
            'any.required': `"password" is required`,
        }),

    displayName: Joi.string().min(2).max(50).required()
        .messages({
            'string.base': `"displayName" should be a type of 'text'`,
            'string.empty': `"displayName" cannot be empty`,
            'string.min': `"displayName" should have at least {#limit} characters`,
            'string.max': `"displayName" should have at most {#limit} characters`,
            'any.required': `"displayName" is required`,
        }),

    photoURL: Joi.string().uri().optional()
        .messages({
            'string.base': `"photoURL" should be a type of 'text'`,
            'string.uri': `"photoURL" should be a valid URL`,
        })
});

export const loginSchema = Joi.object({
    email: Joi.string().email().required()
        .messages({
            'string.base': `"email" should be a type of 'text'`,
            'string.empty': `"email" cannot be empty`,
            'string.email': `"email" must be a valid email`,
            'any.required': `"email" is required`,
        }),

    password: Joi.string().min(6).required()
        .messages({
            'string.base': `"password" should be a type of 'text'`,
            'string.empty': `"password" cannot be empty`,
            'string.min': `"password" should have at least {#limit} characters`,
            'any.required': `"password" is required`,
        })
});

export function validateRegister(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = registerSchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}

export function validateLogin(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = loginSchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}