jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    pickupPointShippingMethodIds: {
      inpost_gb: '99999',
    },
    homeShippingMethodId: '11111',
  },
}));

import {
  normaliseCarrier,
  resolveConfiguredPickupPointShippingMethod,
  resolveHomeShippingMethodId,
} from '../services/shippingMethodResolver';

describe('shippingMethodResolver', () => {
  it('normalises carrier objects using code before name', () => {
    expect(
      normaliseCarrier({
        name: 'InPost',
        code: 'inpost_gb',
      }),
    ).toBe('inpost_gb');
  });

  it('normalises carrier objects using name when code is absent', () => {
    expect(
      normaliseCarrier({
        name: 'InPost',
      }),
    ).toBe('inpost');
  });

  it('prefers the validated order shipping method ID over configured pickup-point methods', () => {
    expect(
      resolveConfiguredPickupPointShippingMethod('12345', 'inpost_gb'),
    ).toEqual({
      id: '12345',
      carrier: 'inpost_gb',
    });
  });

  it('falls back to configured pickup-point methods when order shipping method ID is absent', () => {
    expect(
      resolveConfiguredPickupPointShippingMethod('', 'inpost_gb'),
    ).toEqual({
      id: '99999',
      carrier: 'inpost_gb',
    });
  });

  it('falls back to configured home shipping method ID for home delivery', () => {
    expect(resolveHomeShippingMethodId()).toBe('11111');
  });
});
