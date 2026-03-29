import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const addressSchema = Joi.object({
  line1: Joi.string().required(),
  line2: Joi.string().optional(),
  city: Joi.string().required(),
  state: Joi.string().optional(),
  postal_code: Joi.string().required(),
  country: Joi.string().length(2).uppercase().required(),
});

const pickupPointSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  addressLine1: Joi.string().required(),
  city: Joi.string().required(),
  postalCode: Joi.string().required(),
  country: Joi.string().length(2).uppercase().required(),
  carrier: Joi.string().allow(null).optional(),
});

export const orderSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    'number.base': `"amount" should be a number`,
    'number.integer': `"amount" should be an integer`,
    'number.positive': `"amount" must be greater than 0`,
    'any.required': `"amount" is required`,
  }),
  productId: Joi.string().optional(),
  productName: Joi.string().optional(),
  paymentIntentId: Joi.string().required(),
  deliveryType: Joi.string().valid('home', 'pickup_point').required(),
  shippingOptionId: Joi.string().required(),
  shippingOptionName: Joi.string().optional(),
  shippingOptionPrice: Joi.string().optional(),
  shippingCarrier: Joi.string().optional(),
  shippingWeight: Joi.number().integer().min(1).max(100000).required(),
  shipping: Joi.object({
    address: addressSchema.required(),
    name: Joi.string().required(),
  }).required(),
  pickupPoint: pickupPointSchema.when('deliveryType', {
    is: 'pickup_point',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

export function validateOrder(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { error, value } = orderSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    ResponseHandler.badRequest(
      res,
      'Validation failed',
      error.details[0].message,
    );
    return;
  }
  req.body = value;
  next();
}
