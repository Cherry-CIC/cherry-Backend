import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const addressSchema = Joi.object({
  line1: Joi.string().optional(),
  line2: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  postal_code: Joi.string().optional(),
  country: Joi.string().optional(),
}).optional();

export const orderSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    'number.base': `"amount" should be a number`,
    'number.integer': `"amount" should be an integer`,
    'number.positive': `"amount" must be greater than 0`,
    'any.required': `"amount" is required`,
  }),
  productId: Joi.string().optional(),
  productName: Joi.string().optional(),
  shipping: Joi.object({
    address: addressSchema,
    name: Joi.string().optional(),
  }).optional(),
  /**
   * deliveryMethod drives what the backend does at checkout:
   *   "ship_to_home"  → a Sendcloud parcel is created immediately
   *   "pickup_point"  → parcel creation is deferred; pickupPointId & courier capture the intent
   */
  deliveryMethod: Joi.string()
    .valid('ship_to_home', 'pickup_point')
    .optional()
    .messages({
      'any.only':
        '"deliveryMethod" must be either "ship_to_home" or "pickup_point"',
    }),
  /**
   * courier slug (e.g. "dhl", "ups", "hermes") – required for pickup_point orders so the
   * backend knows which carrier's service points to look up.
   */
  courier: Joi.string().optional(),
  /**
   * Sendcloud service-point ID selected by the user in the app's pickup-point picker.
   * Only relevant (and expected) when deliveryMethod === "pickup_point".
   */
  pickupPointId: Joi.string().optional(),
}).custom((value, helpers) => {
  if (value.deliveryMethod === 'ship_to_home') {
    const address = value.shipping?.address;
    if (!address?.line1 || !address?.city || !address?.postal_code) {
      return helpers.error('any.custom', {
        message:
          '"shipping.address.line1", "shipping.address.city", and "shipping.address.postal_code" are required when deliveryMethod is "ship_to_home"',
      });
    }
  }

  if (value.deliveryMethod === 'pickup_point') {
    if (!value.courier || !value.pickupPointId) {
      return helpers.error('any.custom', {
        message:
          '"courier" and "pickupPointId" are required when deliveryMethod is "pickup_point"',
      });
    }
  }

  return value;
}, 'delivery method validation')
  .messages({
    'any.custom': '{{#message}}',
  });

export function validateOrder(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { error } = orderSchema.validate(req.body);
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
