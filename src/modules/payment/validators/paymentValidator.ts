import Joi from 'joi';
import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

const addressSchema = Joi.object({
  line1: Joi.string().trim().required(),
  line2: Joi.string().allow('').optional(),
  house_number: Joi.string().allow('').optional(),
  city: Joi.string().trim().required(),
  state: Joi.string().allow('').optional(),
  postal_code: Joi.string().trim().required(),
  country: Joi.string().length(2).uppercase().required(),
});

const pickupPointSchema = Joi.object({
  id: Joi.string().trim().required(),
  name: Joi.string().trim().required(),
  addressLine1: Joi.string().trim().required(),
  city: Joi.string().trim().required(),
  postalCode: Joi.string().trim().required(),
  country: Joi.string().length(2).uppercase().required(),
  carrier: Joi.string()
    .trim()
    .lowercase()
    .valid(sendcloudConfig.enforcedCarrier)
    .required(),
});

export const createPaymentIntentValidator = Joi.object({
  productId: Joi.string().trim().required(),
  expectedEditVersion: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
    .strict(),
  shippingMethodId: Joi.string().trim().required(),
  pickupPointId: Joi.string().trim().pattern(/^\d+$/).required(),
  country: Joi.string().length(2).uppercase().required(),
  postalCode: Joi.string().trim().required(),
  shipping: Joi.object({
    address: addressSchema.required(),
    name: Joi.string().trim().required(),
    telephone: Joi.string().trim().required(),
  }).required(),
  pickupPoint: pickupPointSchema.required(),
});

export const cancelPaymentIntentValidator = Joi.object({
  paymentIntentId: Joi.string()
    .trim()
    .pattern(/^pi_[A-Za-z0-9_]+$/)
    .max(255)
    .required(),
});
