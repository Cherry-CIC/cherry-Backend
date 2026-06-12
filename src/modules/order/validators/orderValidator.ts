import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

const ENFORCED_CARRIER = sendcloudConfig.enforcedCarrier;
const addressSchema = Joi.object({
  line1: Joi.string().required(),
  line2: Joi.string().allow('').optional(),
  house_number: Joi.string().allow('').optional(),
  city: Joi.string().required(),
  state: Joi.string().allow('').optional(),
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
  productId: Joi.string().trim().required(),
  paymentIntentId: Joi.string().required(),
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
