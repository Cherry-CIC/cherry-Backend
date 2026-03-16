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