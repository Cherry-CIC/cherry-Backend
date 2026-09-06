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

// Firebase Auth requires phone numbers in E.164 format: a leading "+", a
// non-zero country code, and up to 15 digits in total.
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export const updateProfileSchema = Joi.object({
    displayName: Joi.string().min(2).max(50).optional()
        .messages({
            'string.base': `"displayName" should be a type of 'text'`,
            'string.empty': `"displayName" cannot be empty`,
            'string.min': `"displayName" should have at least {#limit} characters`,
            'string.max': `"displayName" should have at most {#limit} characters`,
        }),

    photoURL: Joi.string().uri().optional()
        .messages({
            'string.base': `"photoURL" should be a type of 'text'`,
            'string.uri': `"photoURL" should be a valid URL`,
        }),

    phoneNumber: Joi.string().pattern(E164_PATTERN).optional()
        .messages({
            'string.base': `"phoneNumber" should be a type of 'text'`,
            'string.empty': `"phoneNumber" cannot be empty`,
            'string.pattern.base': `"phoneNumber" must be in E.164 format, e.g. +447700900000`,
        })
}).min(1)
    .messages({
        'object.min': `At least one of "displayName", "photoURL" or "phoneNumber" is required`,
    });
