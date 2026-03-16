import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const productSchema = Joi.object({
    name: Joi.string().min(3).max(100).required()
        .messages({
            'string.base': `"name" should be a type of 'text'`,
            'string.empty': `"name" cannot be empty`,
            'string.min': `"name" should have at least {#limit} characters`,
            'string.max': `"name" should have at most {#limit} characters`,
            'any.required': `"name" is required`,
        }),

    description: Joi.string().max(500).optional(),

    categoryId: Joi.string().required()
        .messages({
            'string.base': `"categoryId" should be a type of 'text'`,
            'string.empty': `"categoryId" cannot be empty`,
            'any.required': `"categoryId" is required`,
        }),

    charityId: Joi.string().required()
        .messages({
            'string.base': `"charityId" should be a type of 'text'`,
            'string.empty': `"charityId" cannot be empty`,
            'any.required': `"charityId" is required`,
        }),

    quality: Joi.string().required()
        .messages({
            'string.base': `"quality" should be a type of 'text'`,
            'string.empty': `"quality" cannot be empty`,
            'any.required': `"quality" is required`,
        }),

    size: Joi.string().required()
        .messages({
            'string.base': `"size" should be a type of 'text'`,
            'string.empty': `"size" cannot be empty`,
            'any.required': `"size" is required`,
        }),

    product_images: Joi.array().items(Joi.string().uri()).min(1).required()
        .messages({
            'array.base': `"product_images" should be an array`,
            'array.min': `"product_images" should have at least {#limit} image`,
            'any.required': `"product_images" is required`,
        }),

    donation: Joi.number().positive().required()
        .messages({
            'number.base': `"donation" should be a number`,
            'number.positive': `"donation" must be greater than zero`,
            'any.required': `"donation" is required`,
        }),

    price: Joi.number().positive().required()
        .messages({
            'number.base': `"price" should be a number`,
            'number.positive': `"price" must be greater than zero`,
            'any.required': `"price" is required`,
        }),

    likes: Joi.number().integer().min(0).default(0),

    number: Joi.number().integer().min(0).required()
        .messages({
            'number.base': `"number" should be a number`,
            'number.integer': `"number" should be an integer`,
            'number.min': `"number" should be at least {#limit}`,
            'any.required': `"number" is required`,
        })
});

export function validateProduct(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { error } = productSchema.validate(req.body);
    if (error) {
        ResponseHandler.badRequest(res, 'Validation failed', error.details[0].message);
        return;
    }
    next();
}
