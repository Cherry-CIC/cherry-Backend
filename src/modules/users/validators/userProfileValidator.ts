import Joi from 'joi';

export const userIdParamsSchema = Joi.object({
  userId: Joi.string()
    .custom((value: string, helpers) => {
      // Check before trimming so newline/control characters cannot disappear.
      if (/[/\\\x00-\x1f\x7f-\x9f]/.test(value)) {
        return helpers.error('any.invalid');
      }
      const uid = value.trim();
      if (
        !uid ||
        uid.length > 128 ||
        ['.', '..', 'deleted_user'].includes(uid)
      ) {
        return helpers.error('any.invalid');
      }
      return uid;
    })
    .required(),
});

export const userProductsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(20),
  cursor: Joi.string()
    .pattern(/^[A-Za-z0-9_-]+$/)
    .min(40)
    .max(4096),
});
