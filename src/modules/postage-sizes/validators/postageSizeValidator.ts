import Joi from 'joi';

export const postageSizeIdValidator = Joi.object({
  id: Joi.string().trim().required().messages({
    'string.empty': 'Postage size ID is required',
    'any.required': 'Postage size ID is required',
  }),
});

export const postageSizeUpdateValidator = Joi.object({
  description: Joi.string().trim().min(2).max(500).optional(),
  size: Joi.string().trim().min(1).max(50).lowercase().optional(),
  type: Joi.string().trim().min(1).max(50).lowercase().optional(),
  weight: Joi.number().integer().positive().max(100000).optional().messages({
    'number.base': 'Weight must be a number',
    'number.integer': 'Weight must be an integer in grams',
    'number.positive': 'Weight must be greater than 0 grams',
    'number.max': 'Weight must not exceed 100000 grams',
  }),
})
  .min(1)
  .messages({
    'object.min': 'At least one postage size field must be provided',
  });
