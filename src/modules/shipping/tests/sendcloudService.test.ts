import { SendcloudService } from '../services/SendcloudService';

// Mock the sendcloudConfig so constructor doesn't throw
jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    publicKey: 'test-public-key',
    secretKey: 'test-secret-key',
    apiUrl: 'https://panel.sendcloud.sc/api/v2',
  },
}));

// Mock axios so we never make real HTTP calls
jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    get: jest.fn(),
  }),
}));

import axios from 'axios';

describe('SendcloudService.getPickupPoints()', () => {
  let service: SendcloudService;
  let mockGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-grab the mocked axios instance's .get spy
    mockGet = (axios.create as jest.Mock).mock.results[0]?.value?.get;
    if (!mockGet) {
      // axios.create was called fresh
      mockGet = jest.fn();
      (axios.create as jest.Mock).mockReturnValue({ get: mockGet });
    }

    service = new SendcloudService();
    // Override the internal client with our mock
    (service as any).client = { get: mockGet };
  });

  it('calls /service-points with correct params (no courier filter)', async () => {
    mockGet.mockResolvedValue({ data: [] });

    await service.getPickupPoints('SW1A1AA');

    expect(mockGet).toHaveBeenCalledWith('/service-points', {
      params: { country: 'GB', postcode: 'SW1A1AA' },
    });
  });

  it('includes carrier param when courier is provided', async () => {
    mockGet.mockResolvedValue({ data: [] });

    await service.getPickupPoints('SW1A1AA', 'dhl');

    expect(mockGet).toHaveBeenCalledWith('/service-points', {
      params: { country: 'GB', postcode: 'SW1A1AA', carrier: 'dhl' },
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
      {
        id: 2,
        name: 'DHL Express SW2',
        street: 'Low St',
        house_number: '5',
        city: 'London',
        postal_code: 'SW1A2BB',
        country: 'GB',
        carrier: 'dhl',
      },
    ];
    mockGet.mockResolvedValue({ data: mockPoints });

    const result = await service.getPickupPoints('SW1A1AA', 'dhl');

    expect(result).toEqual(mockPoints);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when Sendcloud returns no results', async () => {
    mockGet.mockResolvedValue({ data: [] });

    const result = await service.getPickupPoints('ZZ99ZZ');

    expect(result).toEqual([]);
  });

  it('throws a descriptive error when Sendcloud API returns an error', async () => {
    mockGet.mockRejectedValue({
      response: { data: { error: { message: 'Invalid postcode' } } },
    });

    await expect(service.getPickupPoints('INVALID')).rejects.toThrow(
      'Sendcloud API Error (pickup points): Invalid postcode',
    );
  });

  it('falls back to error.message when no structured error is present', async () => {
    mockGet.mockRejectedValue(new Error('Network timeout'));

    await expect(service.getPickupPoints('SW1A1AA')).rejects.toThrow(
      'Sendcloud API Error (pickup points): Network timeout',
    );
  });
});
