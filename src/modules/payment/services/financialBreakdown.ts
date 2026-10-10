// The amounts known once a payment has succeeded. All in pence.
export interface FinancialBreakdownInput {
  productAmount: number;
  shippingFee: number;
  securityFee: number;
  // Null when Stripe has not reported its fee for the payment yet.
  stripeFee: number | null;
}

// Where each part of the buyer's payment goes. All in pence.
export interface FinancialBreakdown {
  charityProceeds: number;
  shippingFee: number;
  stripeFee: number | null;
  cherryRevenue: number | null;
}

const assertPence = (value: number, field: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Financial breakdown ${field} is invalid`);
  }
};

export const calculateFinancialBreakdown = (
  input: FinancialBreakdownInput,
): FinancialBreakdown => {
  assertPence(input.productAmount, 'productAmount');
  assertPence(input.shippingFee, 'shippingFee');
  assertPence(input.securityFee, 'securityFee');
  if (input.stripeFee !== null) {
    assertPence(input.stripeFee, 'stripeFee');
  }

  // The charity receives the full item price. Stripe's fee comes out of
  // cherry's security fee, so cherry's revenue can be negative.
  return {
    charityProceeds: input.productAmount,
    shippingFee: input.shippingFee,
    stripeFee: input.stripeFee,
    cherryRevenue:
      input.stripeFee === null ? null : input.securityFee - input.stripeFee,
  };
};
