export const gbpToPence = (amount: number): number => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invalid GBP amount');
  }

  return Math.round(amount * 100);
};

export const decimalPriceToPence = (
  amount: string | number | null,
): number | null => {
  if (amount === null || amount === undefined || amount === '') {
    return null;
  }

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
};
