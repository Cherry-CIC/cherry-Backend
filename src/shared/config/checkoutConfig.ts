const SECURITY_FEE_RATE = 0.1;
// Every order carries at least this much, so the fee can cover Stripe's
// fixed charge on low-priced items.
export const MINIMUM_SECURITY_FEE_PENCE = 100;

export const calculateSecurityFeePence = (productAmountPence: number): number =>
  Math.max(
    MINIMUM_SECURITY_FEE_PENCE,
    Math.round(productAmountPence * SECURITY_FEE_RATE),
  );
