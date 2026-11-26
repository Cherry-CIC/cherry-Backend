import Joi from 'joi';

export const testResendEmailSchema = Joi.object({
  to: Joi.string().email().required().messages({
    'string.base': '"to" should be a type of text',
    'string.empty': '"to" cannot be empty',
    'string.email': '"to" must be a valid email',
    'any.required': '"to" is required',
  }),
});

const deviceToken = Joi.string().max(4096).pattern(/^[!-~]+$/).required().messages({
  'string.pattern.base': 'Invalid notification token',
});

export const registerDeviceSchema = Joi.object({
  token: deviceToken,
  platform: Joi.string().valid('ios', 'android').required(),
}).required();

export const removeDeviceSchema = Joi.object({ token: deviceToken }).required();
