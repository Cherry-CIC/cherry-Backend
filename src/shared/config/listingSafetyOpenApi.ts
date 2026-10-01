import {
  LISTING_QUALITIES,
  LISTING_SIZES,
} from '../../modules/products/validators/productValidator';

export const listingSafetySchemas = {
  ListingEdit: {
    type: 'object',
    additionalProperties: false,
    minProperties: 2,
    required: ['expectedEditVersion'],
    properties: {
      expectedEditVersion: {
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER - 1,
      },
      name: {
        type: 'string',
        minLength: 3,
        maxLength: 100,
        description: 'Trimmed before validation.',
      },
      description: { type: 'string', maxLength: 500 },
      categoryId: {
        type: 'string',
        description: 'Existing category document ID.',
      },
      quality: { type: 'string', enum: LISTING_QUALITIES },
      size: { type: 'string', enum: LISTING_SIZES },
      product_images: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'string', format: 'uri' },
        description:
          'Ordered approved Storage URLs. First photo is the main image. Each immutable object must be a verified JPEG, PNG or WebP, at most 10 MiB and 40 million pixels. No animated images.',
      },
    },
  },
  ListingSafetyError: {
    type: 'object',
    required: ['success', 'code', 'message'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      code: { type: 'string' },
      message: { type: 'string' },
      error: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
};
const response = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ListingSafetyError' },
    },
  },
});
export const listingSafetyResponses = {
  ListingValidationError: response(
    'LISTING_VALIDATION_FAILED, LISTING_INVALID_CATEGORY or LISTING_INVALID_MEDIA. No changes committed.',
  ),
  ListingAuthenticationError: response(
    'AUTHENTICATION_REQUIRED. A valid Firebase ID token is required.',
  ),
  ListingOwnershipError: response(
    'LISTING_NOT_OWNER or PAYMENT_NOT_OWNER. The authenticated user does not own the resource.',
  ),
  ListingNotFoundError: response('LISTING_NOT_FOUND.'),
  ListingConflictError: response(
    'LISTING_VERSION_CONFLICT, LISTING_VERSION_REQUIRED, LISTING_VERSION_UNAVAILABLE, LISTING_SAFETY_REVIEW_REQUIRED, LISTING_PAYMENT_PENDING, LISTING_HAS_SALES, LISTING_NOT_EDITABLE, LISTING_NOT_AVAILABLE, CHECKOUT_EXPIRED, CHECKOUT_FINISHED, PAYMENT_STILL_ACTIONABLE, PAYMENT_RECONCILIATION_REQUIRED or ACCOUNT_DELETION_PENDING. Refresh or seek support as appropriate; never retry an edit silently.',
  ),
  ListingDisabledError: response(
    'LISTING_EDIT_DISABLED or LISTING_MEDIA_NOT_READY. Deployment prerequisites are incomplete.',
  ),
};
