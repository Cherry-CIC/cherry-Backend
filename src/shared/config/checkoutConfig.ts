export const calculateSecurityFeePence = (
  productAmountPence: number,
): number => Math.round(productAmountPence * 0.1);
