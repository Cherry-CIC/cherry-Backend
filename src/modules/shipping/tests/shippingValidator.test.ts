import {
  checkoutShippingOptionsQueryValidator,
  pickupPointsQueryValidator,
} from '../validators/shippingValidator';

describe('shipping validators', () => {
  it('accepts a valid checkout shipping options query', () => {
    const { error, value } = checkoutShippingOptionsQueryValidator.validate({
      country: 'GB',
      postalCode: 'SW1A 1AA',
      weight: '2500',
      value: '45.90',
    });

    expect(error).toBeUndefined();
    expect(value.weight).toBe(2500);
  });

  it('rejects pickup points query without postal code', () => {
    const { error } = pickupPointsQueryValidator.validate({
      country: 'GB',
    });

    expect(error).toBeDefined();
  });
});
