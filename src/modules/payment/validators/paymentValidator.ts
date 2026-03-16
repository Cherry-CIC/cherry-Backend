import Joi from 'joi';

export const createPaymentIntentSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    'number.base': '"amount" must be an integer amount in pence',
    'number.integer': '"amount" must be an integer amount in pence',
    'number.positive': '"amount" must be greater than 0',
    'any.required': '"amount" is required',
  }),
});
