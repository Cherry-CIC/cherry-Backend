import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

const addressSchema = Joi.object({
  line1: Joi.string().required(),
  line2: Joi.string().optional(),
  house_number: Joi.string().optional().allow(''),
  city: Joi.string().required(),
  state: Joi.string().optional().allow(''),
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
  carrier: Joi.string().trim().lowercase().optional().allow(null, ''),
  distanceMeters: Joi.number().optional().allow(null),
  latitude: Joi.string().optional().allow(null, ''),
  longitude: Joi.string().optional().allow(null, ''),
  openTomorrow: Joi.boolean().optional(),
  openUpcomingWeek: Joi.boolean().optional(),
});

export const orderSchema = Joi.object({
  deliveryMethod: Joi.string().valid('home', 'pickup_point').required().messages({
    'any.only': `"deliveryMethod" must be either "home" or "pickup_point"`,
    'any.required': `"deliveryMethod" is required`,
  }),
  amount: Joi.number().integer().positive().required().messages({
    'number.base': `"amount" should be a number`,
    'number.integer': `"amount" should be an integer`,
    'number.positive': `"amount" must be greater than 0`,
    'any.required': `"amount" is required`,
  }),
  productId: Joi.string().optional(),
  productName: Joi.string().optional(),
  paymentIntentId: Joi.string().required(),
  shippingMethodId: Joi.string().trim().optional(),
  shippingCarrier: Joi.string().trim().lowercase().optional().allow(null, ''),
  shippingWeight: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(sendcloudConfig.defaultShippingWeightGrams),
  shipping: Joi.object({
    address: addressSchema.required(),
    name: Joi.string().default('Customer'),
    telephone: Joi.string().optional().allow(''),
  }).required(),
  pickupPoint: Joi.when('deliveryMethod', {
    is: 'pickup_point',
    then: pickupPointSchema.required(),
    otherwise: pickupPointSchema.optional(),
  }),
});

function normaliseOrderBody(body: Record<string, any>): Record<string, any> {
  const deliveryMethod =
    body.deliveryMethod ||
    body.delivery_method ||
    body.deliveryType ||
    body.delivery_type ||
    (body.pickupPoint ? 'pickup_point' : 'home');

  return {
    ...body,
    deliveryMethod,
    paymentIntentId: body.paymentIntentId || body.payment_intent_id,
    shippingMethodId:
      body.shippingMethodId || body.shipping_method_id || body.shippingOptionId,
    shippingCarrier: body.shippingCarrier || body.shipping_carrier,
    shippingWeight: body.shippingWeight ?? body.shipping_weight,
  };
}

export function validateOrder(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { error, value } = orderSchema.validate(normaliseOrderBody(req.body), {
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
