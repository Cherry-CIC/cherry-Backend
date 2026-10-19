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
        description:
          'The editVersion from the latest listing response. Legacy listings start at zero.',
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
          'Ordered immutable listing-media-v1 uploads belonging to the seller. First photo is the main image. All retained photos are validated on every edit.',
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
    'LISTING_VALIDATION_FAILED, LISTING_INVALID_MEDIA or LISTING_INVALID_CATEGORY. No changes committed.',
  ),
  ListingAuthenticationError: {
    description:
      'A valid Firebase ID token is required. Uses the existing authentication error envelope (success, message, error, timestamp).',
  },
  ListingOwnershipError: response(
    'LISTING_NOT_OWNER or PAYMENT_NOT_OWNER. The authenticated user does not own the resource.',
  ),
  ListingNotFoundError: response('LISTING_NOT_FOUND.'),
  ListingConflictError: response(
    'LISTING_VERSION_CONFLICT, LISTING_VERSION_REQUIRED, LISTING_PAYMENT_PENDING, LISTING_HAS_SALES, LISTING_NOT_EDITABLE, LISTING_NOT_AVAILABLE, LISTING_REVIEW_REQUIRED, LISTING_MEDIA_RETIRED, CHECKOUT_EXPIRED, CHECKOUT_FINISHED, PAYMENT_STILL_ACTIONABLE, PAYMENT_RECONCILIATION_REQUIRED or ACCOUNT_DELETION_PENDING. Refresh or seek support as appropriate.',
  ),
};
