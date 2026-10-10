import type { UpdateProductData } from '../services/ProductService';
import {
  ListingSafetyError,
  sendListingSafetyError,
} from '../../../shared/utils/listingSafety';
import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

export const productSchema = Joi.object({
  name: Joi.string().min(3).max(100).required().messages({
    'string.base': `"name" should be a type of 'text'`,
    'string.empty': `"name" cannot be empty`,
    'string.min': `"name" should have at least {#limit} characters`,
    'string.max': `"name" should have at most {#limit} characters`,
    'any.required': `"name" is required`,
  }),

  description: Joi.string().max(500).optional(),

  categoryId: Joi.string().required().messages({
    'string.base': `"categoryId" should be a type of 'text'`,
    'string.empty': `"categoryId" cannot be empty`,
    'any.required': `"categoryId" is required`,
  }),

  charityId: Joi.string().required().messages({
    'string.base': `"charityId" should be a type of 'text'`,
    'string.empty': `"charityId" cannot be empty`,
    'any.required': `"charityId" is required`,
  }),

  postageSize: Joi.string().required().messages({
    'string.base': `"postageSize" should be a type of 'text'`,
    'string.empty': `"postageSize" cannot be empty`,
    'any.required': `"postageSize" is required`,
  }),

  quality: Joi.string().required().messages({
    'string.base': `"quality" should be a type of 'text'`,
    'string.empty': `"quality" cannot be empty`,
    'any.required': `"quality" is required`,
  }),

  size: Joi.string().required().messages({
    'string.base': `"size" should be a type of 'text'`,
    'string.empty': `"size" cannot be empty`,
    'any.required': `"size" is required`,
  }),

  product_images: Joi.array()
    .items(Joi.string().uri())
    .min(1)
    .required()
    .messages({
      'array.base': `"product_images" should be an array`,
      'array.min': `"product_images" should have at least {#limit} image`,
      'any.required': `"product_images" is required`,
    }),

  donation: Joi.number().positive().required().messages({
    'number.base': `"donation" should be a number`,
    'number.positive': `"donation" must be greater than zero`,
    'any.required': `"donation" is required`,
  }),

  price: Joi.number().positive().required().messages({
    'number.base': `"price" should be a number`,
    'number.positive': `"price" must be greater than zero`,
    'any.required': `"price" is required`,
  }),

  likes: Joi.number().integer().min(0).default(0),

  number: Joi.number().integer().min(0).required().messages({
    'number.base': `"number" should be a number`,
    'number.integer': `"number" should be an integer`,
    'number.min': `"number" should be at least {#limit}`,
    'any.required': `"number" is required`,
  }),
});

// These values match the Give form in frontend PR #525. Unchanged legacy values
// can remain stored, but cannot be submitted as new values.
export const LISTING_QUALITIES = [
  'NEW',
  'EXCELLENT',
  'GOOD',
  'FAIR',
  'WORN',
  'TEXTILES',
];
export const LISTING_SIZES = [
  'XS',
  'Small',
  'Medium',
  'Large',
  'XL',
  'XXL',
  'One Size',
];
export const productUpdateSchema = Joi.object({
  expectedEditVersion: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
    .strict()
    .required(),
  name: Joi.string().trim().min(3).max(100),
  description: Joi.string().max(500).allow(''),
  categoryId: Joi.string().pattern(/^[^/\\\x00-\x1f]{1,128}$/),
  quality: Joi.string().valid(...LISTING_QUALITIES),
  size: Joi.string().valid(...LISTING_SIZES),
  product_images: Joi.array()
    .items(
      Joi.string()
        .uri({ scheme: ['https'] })
        .max(4096),
    )
    .min(1)
    .max(10)
    .unique(),
})
  .unknown(false)
  .min(2);

export function parseListingEdit(input: unknown): UpdateProductData {
  const { error, value } = productUpdateSchema.validate(input, {
    abortEarly: true,
    stripUnknown: false,
  });
  if (error)
    throw new ListingSafetyError(
      400,
      'LISTING_VALIDATION_FAILED',
      error.details[0].message,
    );
  return value;
}

export const productListQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(20),
  cursor: Joi.string().base64().optional(),
  search: Joi.string().trim().max(100).optional(),
  categoryId: Joi.string().trim().optional(),
  charityId: Joi.string().trim().optional(),
  size: Joi.string().trim().optional(),
  quality: Joi.string().trim().optional(),
  status: Joi.string().valid('active', 'unlisted', 'sold').optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
})
  .custom((value, helpers) => {
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      value.minPrice > value.maxPrice
    ) {
      return helpers.error('any.invalid');
    }

    return value;
  })
  .messages({
    'any.invalid': '"minPrice" cannot be greater than "maxPrice"',
  });

export function validateProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { error } = productSchema.validate(req.body);
  if (error) {
    ResponseHandler.badRequest(
      res,
      'Validation failed',
      error.details[0].message,
    );
    return;
  }
  next();
}

export function validateProductUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    req.body = parseListingEdit(req.body);
    next();
  } catch (error) {
    sendListingSafetyError(res, error);
  }
}
