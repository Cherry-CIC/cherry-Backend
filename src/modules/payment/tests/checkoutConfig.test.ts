import {
  calculateSecurityFeePence,
  MINIMUM_SECURITY_FEE_PENCE,
} from '../../../shared/config/checkoutConfig';

describe('calculateSecurityFeePence', () => {
  it('charges 10% of the item price', () => {
    expect(calculateSecurityFeePence(2000)).toBe(200);
    expect(calculateSecurityFeePence(1250)).toBe(125);
  });

  it('rounds to a whole penny', () => {
    expect(calculateSecurityFeePence(1999)).toBe(200);
  });

  it('never charges less than the minimum fee', () => {
    expect(MINIMUM_SECURITY_FEE_PENCE).toBe(100);
    expect(calculateSecurityFeePence(100)).toBe(100);
    expect(calculateSecurityFeePence(499)).toBe(100);
    expect(calculateSecurityFeePence(1000)).toBe(100);
    expect(calculateSecurityFeePence(1001)).toBe(100);
    expect(calculateSecurityFeePence(1010)).toBe(101);
  });
});
