export const PAYMENT_CURRENCY = 'gbp';

export const INVALID_PAYMENT_AMOUNT_MESSAGE =
  'Amount must be a positive integer in the smallest currency unit';

const integerPencePattern = /^\d+$/;

const assertPositiveIntegerPence = (amount: number): number => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(INVALID_PAYMENT_AMOUNT_MESSAGE);
  }

  return amount;
};

export const parsePositivePenceAmount = (amount: unknown): number => {
  if (typeof amount === 'number') {
    return assertPositiveIntegerPence(amount);
  }

  if (typeof amount === 'string') {
    const trimmedAmount = amount.trim();

    if (!integerPencePattern.test(trimmedAmount)) {
      throw new Error(INVALID_PAYMENT_AMOUNT_MESSAGE);
    }

    return assertPositiveIntegerPence(Number(trimmedAmount));
  }

  throw new Error(INVALID_PAYMENT_AMOUNT_MESSAGE);
};
