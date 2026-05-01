import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';

const addressSchema = Joi.object({
  line1: Joi.string().optional(),
  line2: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  postal_code: Joi.string().optional(),
  country: Joi.string().valid('GB').optional(),
}).optional();

const pickupPointSchema = Joi.object({
  id: Joi.string().optional(),
  name: Joi.string().optional(),
  addressLine1: Joi.string().optional(),
  city: Joi.string().optional(),
  postalCode: Joi.string().optional(),
  country: Joi.string().valid('GB').optional(),
  carrier: Joi.string().optional(),
}).optional();

export const orderSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    'number.base': `"amount" should be a number`,
    'number.integer': `"amount" should be an integer`,
    'number.positive': `"amount" must be greater than 0`,
    'any.required': `"amount" is required`,
  }),
  paymentIntentId: Joi.string().required().messages({
    'string.base': `"paymentIntentId" should be a type of 'text'`,
    'string.empty': `"paymentIntentId" cannot be empty`,
    'any.required': `"paymentIntentId" is required`,
  }),
  productId: Joi.string().required().messages({
    'string.base': `"productId" should be a type of 'text'`,
    'string.empty': `"productId" cannot be empty`,
    'any.required': `"productId" is required`,
  }),
  productName: Joi.string().optional(),
  deliveryType: Joi.string().valid('home', 'pickup_point').optional(),
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
  shippingOptionId: Joi.string().required().messages({
    'string.base': `"shippingOptionId" should be a type of 'text'`,
    'string.empty': `"shippingOptionId" cannot be empty`,
    'any.required': `"shippingOptionId" is required`,
  }),
  shippingOptionName: Joi.string().optional(),
  shippingOptionPrice: Joi.number().integer().min(0).optional(),
  shippingCarrier: Joi.string().optional(),
  shippingWeight: Joi.number().integer().positive().optional(),
  pickupPoint: pickupPointSchema,
})
  .custom((value, helpers) => {
    const shippingAddress = value.shipping?.address;
    const deliveryType =
      value.deliveryType ||
      (value.deliveryMethod === 'ship_to_home' ? 'home' : value.deliveryMethod);

    if (!deliveryType) {
      return helpers.error('any.custom', {
        message:
          '"deliveryType" is required and must be either "home" or "pickup_point"',
      });
    }

    if (
      value.deliveryType === 'home' &&
      value.deliveryMethod &&
      value.deliveryMethod !== 'ship_to_home'
    ) {
      return helpers.error('any.custom', {
        message:
          '"deliveryType" and "deliveryMethod" describe different delivery flows',
      });
    }

    if (
      value.deliveryType === 'pickup_point' &&
      value.deliveryMethod &&
      value.deliveryMethod !== 'pickup_point'
    ) {
      return helpers.error('any.custom', {
        message:
          '"deliveryType" and "deliveryMethod" describe different delivery flows',
      });
    }

    if (deliveryType === 'home') {
      if (!shippingAddress) {
        return helpers.error('any.custom', {
          message:
            '"shipping.address" is required when "deliveryType" is "home"',
        });
      }

      const requiredAddressFields = ['line1', 'city', 'postal_code', 'country'];
      const missingField = requiredAddressFields.find(
        (field) => !shippingAddress[field],
      );

      if (missingField) {
        return helpers.error('any.custom', {
          message: `"shipping.address.${missingField}" is required when "deliveryType" is "home"`,
        });
      }

      if (value.shippingOptionId !== 'mvp-home-delivery') {
        return helpers.error('any.custom', {
          message:
            '"shippingOptionId" must be "mvp-home-delivery" when "deliveryType" is "home"',
        });
      }
    }

    if (deliveryType === 'pickup_point') {
      const pickupPoint = value.pickupPoint;
      if (!pickupPoint && !(value.pickupPointId && value.courier)) {
        return helpers.error('any.custom', {
          message:
            '"pickupPoint" is required when "deliveryType" is "pickup_point"',
        });
      }

      if (pickupPoint) {
        const requiredPickupFields = [
          'id',
          'name',
          'addressLine1',
          'city',
          'postalCode',
          'country',
        ];
        const missingPickupField = requiredPickupFields.find(
          (field) => !pickupPoint[field],
        );

        if (missingPickupField) {
          return helpers.error('any.custom', {
            message: `"pickupPoint.${missingPickupField}" is required when "deliveryType" is "pickup_point"`,
          });
        }
      }

      if (value.shippingOptionId !== 'mvp-pickup-point-delivery') {
        return helpers.error('any.custom', {
          message:
            '"shippingOptionId" must be "mvp-pickup-point-delivery" when "deliveryType" is "pickup_point"',
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
