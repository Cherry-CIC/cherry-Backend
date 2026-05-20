import { SendcloudService } from '../services/SendcloudService';

jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    publicKey: 'test-public-key',
    secretKey: 'test-secret-key',
    apiUrl: 'https://panel.sendcloud.sc/api/v2',
    servicePointsApiUrl: 'https://servicepoints.sendcloud.sc/api/v2',
    enforcedCarrier: 'inpost_gb',
    pickupPointShippingMethodIds: {},
    homeShippingMethodId: '',
    defaultShippingWeightGrams: 1000,
  },
}));

jest.mock('axios', () => ({
  create: jest.fn(),
}));

import axios from 'axios';

describe('SendcloudService service-point lookup', () => {
  let servicePointsGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    const panelClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
    };
    const servicePointsClient = {
      get: jest.fn(),
    };

    (axios.create as jest.Mock)
      .mockReturnValueOnce(panelClient)
      .mockReturnValueOnce(servicePointsClient);

    servicePointsGet = servicePointsClient.get;
  });

  it('calls /service-points with country, address, radius, carrier and access token', async () => {
    servicePointsGet.mockResolvedValue({ data: [] });
    const service = new SendcloudService();

    await service.getServicePoints({
      country: 'GB',
      address: 'SW1A 1AA',
      radius: 5000,
      carrier: 'inpost_gb',
    });

    expect(servicePointsGet).toHaveBeenCalledWith('/service-points', {
      params: {
        access_token: 'test-public-key',
        country: 'GB',
        address: 'SW1A 1AA',
        radius: 5000,
        carrier: 'inpost_gb',
      },
    });
  });

  it('returns the pickup point array from the response', async () => {
    const mockPoints = [
      {
        id: 1,
        name: 'DHL Express SW1',
        street: 'High St',
        house_number: '10',
        city: 'London',
        postal_code: 'SW1A1AA',
        country: 'GB',
        carrier: 'dhl',
      },
    ];
    servicePointsGet.mockResolvedValue({ data: mockPoints });
    const service = new SendcloudService();

    const result = await service.getServicePoints({
      country: 'GB',
      address: 'SW1A 1AA',
    });

    expect(result).toEqual(mockPoints);
  });

  it('throws a descriptive error when Sendcloud returns an error', async () => {
    servicePointsGet.mockRejectedValue({
      response: { data: { error: { message: 'Invalid postcode' } } },
    });
    const service = new SendcloudService();

    await expect(
      service.getServicePoints({
        country: 'GB',
        address: 'INVALID',
      }),
    ).rejects.toThrow('Sendcloud API Error: Invalid postcode');
  });
});
