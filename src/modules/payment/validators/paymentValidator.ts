import Joi from 'joi';

export const createPaymentIntentValidator = Joi.object({
  expectedEditVersion: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
    .strict()
    .optional(),
  productId: Joi.string().trim().required(),
  shippingMethodId: Joi.string().trim().required(),
  pickupPointId: Joi.string().trim().pattern(/^\d+$/).required(),
  country: Joi.string().length(2).uppercase().required(),
  postalCode: Joi.string().trim().required(),
});
