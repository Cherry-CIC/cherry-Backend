import {
  checkoutShippingOptionsQueryValidator,
  pickupPointsQueryValidator,
} from '../validators/shippingValidator';

describe('shipping validators', () => {
  it('accepts a valid checkout shipping options query', () => {
    const { error, value } = checkoutShippingOptionsQueryValidator.validate({
      servicePointId: '12345678',
      country: 'GB',
      postalCode: 'SW1A 1AA',
    });

    expect(error).toBeUndefined();
    expect(value.servicePointId).toBe('12345678');
  });

  it('rejects pickup points query without address', () => {
    const { error } = pickupPointsQueryValidator.validate({
      country: 'GB',
    });

    expect(error).toBeDefined();
  });

  it('accepts pickup points query with address only', () => {
    const { error } = pickupPointsQueryValidator.validate({
      country: 'GB',
      address: 'SE18 5AB',
      radius: 5000,
    });

    expect(error).toBeUndefined();
  });
});
