import { CheckoutShippingService } from '../services/CheckoutShippingService';

describe('CheckoutShippingService', () => {
  it('normalises Sendcloud service points into the frontend pickup-point shape', async () => {
    const sendcloudService: any = {
      getServicePoints: jest.fn().mockResolvedValue([
        {
          id: 123,
          name: 'Pickup Point One',
          street: 'Test Street',
          house_number: '1',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'gb',
          carrier: 'inpost_gb',
          distance: '250',
          latitude: 51.501,
          longitude: -0.1416,
          open_tomorrow: true,
          open_upcoming_week: 'true',
        },
      ]),
    };
    const service = new CheckoutShippingService(sendcloudService);

    const result = await service.getPickupPoints({
      country: 'GB',
      address: 'SW1A 1AA',
      radius: 5000,
    });

    expect(result).toEqual([
      {
        id: '123',
        name: 'Pickup Point One',
        addressLine1: 'Test Street 1',
        city: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
        carrier: 'inpost_gb',
        distanceMeters: 250,
        latitude: '51.501',
        longitude: '-0.1416',
        openTomorrow: true,
        openUpcomingWeek: true,
      },
    ]);
  });

  it('filters out service points missing required display fields', async () => {
    const sendcloudService: any = {
      getServicePoints: jest.fn().mockResolvedValue([
        {
          id: 123,
          name: 'Complete Point',
          street: 'Test Street',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
        {
          id: 456,
          name: 'Missing Address',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
      ]),
    };
    const service = new CheckoutShippingService(sendcloudService);

    const result = await service.getPickupPoints({
      country: 'GB',
      address: 'SW1A 1AA',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('123');
  });

  it('normalises carrier objects with name when code is absent', async () => {
    const sendcloudService: any = {
      getServicePoints: jest.fn().mockResolvedValue([
        {
          id: 123,
          name: 'Pickup Point One',
          street: 'Test Street',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
          carrier: {
            name: 'InPost',
          },
        },
      ]),
    };
    const service = new CheckoutShippingService(sendcloudService);

    const result = await service.getPickupPoints({
      country: 'GB',
      address: 'SW1A 1AA',
    });

    expect(result[0].carrier).toBe('inpost');
  });
});
