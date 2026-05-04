import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;

const addressSchema = Joi.object({
  line1: Joi.string().required(),
  line2: Joi.string().optional(),
  house_number: Joi.string().required(),
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
  carrier: Joi.string().trim().lowercase().valid(ENFORCED_CARRIER).required().messages({
    'any.only': `"pickupPoint.carrier" must be "${ENFORCED_CARRIER}"`,
    'any.required': `"pickupPoint.carrier" is required`,
  }),
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
  shippingMethodId: Joi.string().required(),
  shippingCarrier: Joi.string().trim().lowercase().valid(ENFORCED_CARRIER).required().messages({
    'any.only': `"shippingCarrier" must be "${ENFORCED_CARRIER}"`,
    'any.required': `"shippingCarrier" is required`,
  }),
  shippingWeight: Joi.number().integer().min(1).max(100000).required(),
  shipping: Joi.object({
    address: addressSchema.required(),
    name: Joi.string().required(),
    telephone: Joi.string().required(),
  }).required(),
  pickupPoint: pickupPointSchema.required(),
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
