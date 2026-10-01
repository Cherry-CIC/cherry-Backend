import { Response } from 'express';

/** Operational release gate. Never enable before the release checklist passes. */
export const listingEditingEnabled = (): boolean =>
  process.env.LISTING_EDIT_ENABLED === 'true';

export class ListingSafetyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ListingSafetyError';
  }
}

export function sendListingSafetyError(res: Response, error: unknown): boolean {
  if (!(error instanceof ListingSafetyError)) return false;
  res.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
    error: error.message,
    timestamp: new Date().toISOString(),
  });
  return true;
}

export function requireVersion(data: { editVersion?: unknown }): number {
  if (
    !Number.isSafeInteger(data.editVersion) ||
    (data.editVersion as number) < 0 ||
    (data.editVersion as number) >= Number.MAX_SAFE_INTEGER
  ) {
    throw new ListingSafetyError(
      409,
      'LISTING_VERSION_UNAVAILABLE',
      'This listing needs a safety review before it can be changed.',
    );
  }
  return data.editVersion as number;
}

/** Apply only at the API boundary, never before a payment/ownership check. */
export function exposedListing<T extends object>(data: T): T {
  const result = { ...data } as Record<string, unknown>;
  if (result.status === undefined && typeof result.number === 'number') {
    result.status = result.number > 0 ? 'active' : 'sold';
  }
  for (const key of [
    'paymentReservationId',
    'editSafetyVerified',
    'hasSales',
    'hasBeenEdited',
  ])
    delete result[key];
  if (
    !listingEditingEnabled() ||
    !Number.isSafeInteger(result.editVersion) ||
    Number(result.editVersion) < 0
  )
    delete result.editVersion;
  return result as T;
}

export function assertOwner(data: { userId?: unknown }, uid: string): void {
  if (!uid)
    throw new ListingSafetyError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Sign in to change this listing.',
    );
  if (data.userId !== uid)
    throw new ListingSafetyError(
      403,
      'LISTING_NOT_OWNER',
      'You can only change your own listings.',
    );
}

export function assertUnreserved(data: {
  paymentReservationId?: unknown;
}): void {
  if (data.paymentReservationId)
    throw new ListingSafetyError(
      409,
      'LISTING_PAYMENT_PENDING',
      'A payment is in progress for this listing.',
    );
}

export function assertSafetyVerified(data: {
  editSafetyVerified?: unknown;
}): void {
  if (data.editSafetyVerified !== true)
    throw new ListingSafetyError(
      409,
      'LISTING_SAFETY_REVIEW_REQUIRED',
      'This listing needs a safety review before it can be changed.',
    );
}
