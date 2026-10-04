import { calculateFinancialBreakdown } from '../services/financialBreakdown';

describe('calculateFinancialBreakdown', () => {
  it('gives the charity the full item price and takes the Stripe fee from the security fee', () => {
    expect(
      calculateFinancialBreakdown({
        productAmount: 10000,
        shippingFee: 0,
        securityFee: 1000,
        stripeFee: 230,
      }),
    ).toEqual({
      charityProceeds: 10000,
      shippingFee: 0,
      stripeFee: 230,
      cherryRevenue: 770,
    });
  });

  it('keeps shipping as its own line so the parts add up to the amount charged', () => {
    const input = {
      productAmount: 2000,
      shippingFee: 300,
      securityFee: 200,
      stripeFee: 58,
    };
    const breakdown = calculateFinancialBreakdown(input);

    expect(breakdown).toEqual({
      charityProceeds: 2000,
      shippingFee: 300,
      stripeFee: 58,
      cherryRevenue: 142,
    });
    expect(
      breakdown.charityProceeds +
        breakdown.shippingFee +
        breakdown.stripeFee! +
        breakdown.cherryRevenue!,
    ).toBe(input.productAmount + input.shippingFee + input.securityFee);
  });

  it('lets cherry revenue go negative rather than reducing charity proceeds', () => {
    const breakdown = calculateFinancialBreakdown({
      productAmount: 1000,
      shippingFee: 1000,
      securityFee: 100,
      stripeFee: 133,
    });

    expect(breakdown.charityProceeds).toBe(1000);
    expect(breakdown.cherryRevenue).toBe(-33);
  });

  it('handles a Stripe fee of zero', () => {
    const breakdown = calculateFinancialBreakdown({
      productAmount: 2000,
      shippingFee: 300,
      securityFee: 200,
      stripeFee: 0,
    });

    expect(breakdown.cherryRevenue).toBe(200);
  });

  it('leaves cherry revenue unknown when Stripe has not reported its fee', () => {
    expect(
      calculateFinancialBreakdown({
        productAmount: 2000,
        shippingFee: 300,
        securityFee: 200,
        stripeFee: null,
      }),
    ).toEqual({
      charityProceeds: 2000,
      shippingFee: 300,
      stripeFee: null,
      cherryRevenue: null,
    });
  });

  it.each([
    ['productAmount', { productAmount: 19.99 }],
    ['shippingFee', { shippingFee: -1 }],
    ['securityFee', { securityFee: Number.NaN }],
    ['stripeFee', { stripeFee: 57.5 }],
  ])('rejects an invalid %s', (field, override) => {
    expect(() =>
      calculateFinancialBreakdown({
        productAmount: 2000,
        shippingFee: 300,
        securityFee: 200,
        stripeFee: 58,
        ...override,
      }),
    ).toThrow(`Financial breakdown ${field} is invalid`);
  });
});
