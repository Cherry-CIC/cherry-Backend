import Joi from 'joi';

export const saveAddressValidator = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': '"fullName" cannot be empty',
    'string.min': '"fullName" should have at least {#limit} characters',
    'any.required': '"fullName" is required',
  }),
  country: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': '"country" cannot be empty',
    'any.required': '"country" is required',
  }),
  addressLine1: Joi.string().trim().min(3).max(200).required().messages({
    'string.empty': '"addressLine1" cannot be empty',
    'any.required': '"addressLine1" is required',
  }),
  addressLine2: Joi.string().trim().max(200).allow('').optional(),
  postcode: Joi.string().trim().min(2).max(20).required().messages({
    'string.empty': '"postcode" cannot be empty',
    'any.required': '"postcode" is required',
  }),
  city: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': '"city" cannot be empty',
    'any.required': '"city" is required',
  }),
});

export const createTestParcelValidator = Joi.object({
  parcel: Joi.object({
    name: Joi.string().required(),
    address: Joi.string().required(),
    house_number: Joi.string().required(),
    city: Joi.string().required(),
    postal_code: Joi.string().required(),
    country: Joi.string().length(2).uppercase().required(),
    email: Joi.string().email().required(),
    telephone: Joi.string().required(),
    request_label: Joi.boolean().required(),
    shipment: Joi.object({
      id: Joi.number().integer().required(),
    }).required(),
    to_service_point: Joi.number().integer().required(),
    weight: Joi.alternatives(Joi.string(), Joi.number()).required(),
    order_number: Joi.string().required(),
  }).required(),
});

export const checkoutShippingOptionsQueryValidator = Joi.object({
  productId: Joi.string().trim().required().messages({
    'string.empty': 'Product ID is required',
    'any.required': 'Product ID is required',
  }),
  servicePointId: Joi.string().trim().pattern(/^\d+$/).required().messages({
    'string.pattern.base': 'Service point ID must be numeric',
    'any.required': 'Service point ID is required',
  }),
  senderAddress: Joi.string()
    .trim()
    .pattern(/^(\d+|all)$/i)
    .optional()
    .messages({
      'string.pattern.base': 'Sender address must be numeric or "all"',
    }),
  country: Joi.string().length(2).uppercase().required().messages({
    'string.length': 'Country must be a 2-letter ISO code',
    'any.required': 'Country is required',
  }),
  postalCode: Joi.string().trim().required().messages({
    'string.empty': 'Postal code is required',
    'any.required': 'Postal code is required',
  }),
  isReturn: Joi.boolean().truthy('true').falsy('false').optional(),
});

export const pickupPointsQueryValidator = Joi.object({
  country: Joi.string().length(2).uppercase().required().messages({
    'string.length': 'Country must be a 2-letter ISO code',
    'any.required': 'Country is required',
  }),
  address: Joi.string().trim().required().messages({
    'string.empty': 'Address is required',
    'any.required': 'Address is required',
  }),
  radius: Joi.number().integer().min(100).max(50000).optional().messages({
    'number.base': 'Radius must be a number',
    'number.integer': 'Radius must be an integer',
    'number.min': 'Radius must be at least 100 meters',
    'number.max': 'Radius must not exceed 50000 meters',
  }),
  carrier: Joi.string().trim().optional(),
});

export const postcodeValidationQueryValidator = Joi.object({
  postcode: Joi.string().trim().required().messages({
    'string.empty': 'Postcode is required',
    'any.required': 'Postcode is required',
  }),
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
