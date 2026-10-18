import { Response } from 'express';

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

/** Legacy listings start at zero. Malformed stored versions are never writable. */
export function listingEditVersion(data: { editVersion?: unknown }): number {
  if (data.editVersion === undefined) return 0;
  if (
    typeof data.editVersion !== 'number' ||
    !Number.isSafeInteger(data.editVersion) ||
    data.editVersion < 0
  )
    throw new ListingSafetyError(
      409,
      'LISTING_NOT_EDITABLE',
      'This listing needs to be checked before it can be changed.',
    );
  return data.editVersion;
}

export function hasPendingPayment(data: {
  status?: unknown;
  reservationActive?: unknown;
}): boolean {
  return data.status === 'pending_payment' || data.reservationActive === true;
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

/** Apply only at the API boundary, never before a payment/ownership check. */
export function exposedListing<T extends object>(data: T): T {
  const result = { ...data } as Record<string, unknown>;
  if (result.status === undefined && typeof result.number === 'number') {
    result.status = result.number > 0 ? 'active' : 'sold';
  }
  try {
    result.editVersion = listingEditVersion(result);
  } catch {
    delete result.editVersion;
  }
  for (const key of ['hasSales', 'hasBeenEdited']) delete result[key];
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
