import Joi from 'joi';

/**
 * Validator for creating a shipment
 */
export const createShipmentValidator = Joi.object({
  orderId: Joi.string().required().messages({
    'string.empty': 'Order ID is required',
    'any.required': 'Order ID is required',
  }),
  weight: Joi.number().integer().min(1).max(100000).optional().messages({
    'number.base': 'Weight must be a number',
    'number.min': 'Weight must be at least 1 gram',
    'number.max': 'Weight must not exceed 100kg (100000 grams)',
  }),
  shippingMethodId: Joi.number().integer().optional().messages({
    'number.base': 'Shipping method ID must be a number',
  }),
});

/**
 * Validator for order ID parameter
 */
export const orderIdParamValidator = Joi.object({
  orderId: Joi.string().required().messages({
    'string.empty': 'Order ID is required',
    'any.required': 'Order ID is required',
  }),
});

/**
 * Validator for shipment status query
 */
export const shipmentStatusQueryValidator = Joi.object({
  status: Joi.string()
    .valid('pending', 'announced', 'en_route', 'out_for_delivery', 'delivered', 'exception', 'cancelled')
    .optional()
    .messages({
      'any.only': 'Invalid status value',
    }),
});

export const checkoutShippingOptionsQueryValidator = Joi.object({
  country: Joi.string().length(2).uppercase().required().messages({
    'string.length': 'Country must be a 2-letter ISO code',
    'any.required': 'Country is required',
  }),
  postalCode: Joi.string().trim().required().messages({
    'string.empty': 'Postal code is required',
    'any.required': 'Postal code is required',
  }),
  weight: Joi.number().integer().min(1).max(100000).required().messages({
    'number.base': 'Weight must be a number',
    'number.min': 'Weight must be at least 1 gram',
    'number.max': 'Weight must not exceed 100kg (100000 grams)',
    'any.required': 'Weight is required',
  }),
  value: Joi.string().trim().required().messages({
    'string.empty': 'Value is required',
    'any.required': 'Value is required',
  }),
});

export const pickupPointsQueryValidator = Joi.object({
  country: Joi.string().length(2).uppercase().required().messages({
    'string.length': 'Country must be a 2-letter ISO code',
    'any.required': 'Country is required',
  }),
  postalCode: Joi.string().trim().required().messages({
    'string.empty': 'Postal code is required',
    'any.required': 'Postal code is required',
  }),
  city: Joi.string().trim().optional(),
  address: Joi.string().trim().optional(),
  houseNumber: Joi.string().trim().optional(),
  weight: Joi.number().min(0).max(100).optional().messages({
    'number.base': 'Weight must be a number',
    'number.max': 'Weight must not exceed 100kg',
  }),
  carrier: Joi.string().trim().optional(),
});

export const sendcloudWebhookValidator = Joi.object({
  action: Joi.string().required(),
  timestamp: Joi.alternatives(Joi.string(), Joi.number()).optional(),
  parcel: Joi.object({
    id: Joi.number().required(),
    tracking_number: Joi.string().allow(null).optional(),
    tracking_url: Joi.string().allow(null).optional(),
    status: Joi.object({
      message: Joi.string().allow('', null).optional(),
    }).optional(),
  }).required(),
});
