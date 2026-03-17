jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    publicKey: 'test-public-key',
    secretKey: 'test-secret-key',
    webhookSecret: 'test-webhook-secret',
    apiUrl: 'https://panel.sendcloud.sc/api/v2',
    mode: 'live',
  },
}));

jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    get: jest.fn(),
    post: jest.fn(),
  }),
}));

import axios from 'axios';
import { SendcloudService } from '../services/SendcloudService';

describe('SendcloudService', () => {
  let service: SendcloudService;
  let mockGet: jest.Mock;
  let mockPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGet = jest.fn();
    mockPost = jest.fn();
    (axios.create as jest.Mock).mockReturnValue({
      get: mockGet,
      post: mockPost,
    });

    service = new SendcloudService();
    (service as any).client = { get: mockGet, post: mockPost };
  });

  describe('getPickupPoints()', () => {
    it('calls /service-points with correct params when no courier filter is provided', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await service.getPickupPoints('SW1A1AA');

      expect(mockGet).toHaveBeenCalledWith('/service-points', {
        params: { country: 'GB', postcode: 'SW1A1AA' },
      });
    });

    it('includes the carrier param when courier is provided', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await service.getPickupPoints('SW1A1AA', 'dhl');

      expect(mockGet).toHaveBeenCalledWith('/service-points', {
        params: { country: 'GB', postcode: 'SW1A1AA', carrier: 'dhl' },
      });
    });
  });

  describe('getShippingMethods()', () => {
    it('requests service-point compatible methods when servicePointId is provided', async () => {
      mockGet.mockResolvedValue({ data: { shipping_methods: [] } });

      await service.getShippingMethods({ servicePointId: 'pickup-123' });

      expect(mockGet).toHaveBeenCalledWith('/shipping_methods', {
        params: { service_point_id: 'pickup-123' },
      });
    });
  });

  describe('createParcelToServicePoint()', () => {
    it('posts the Sendcloud service-point payload shape', async () => {
      mockPost.mockResolvedValue({
        data: {
          parcel: {
            id: 42,
            tracking_number: 'TRACK-42',
          },
        },
      });

      await service.createParcelToServicePoint(
        {
          name: 'Customer',
          address: '1 High Street',
          city: 'London',
          postal_code: 'SW1A1AA',
          country: 'GB',
          email: 'hello@example.com',
          order_number: 'order-123',
          weight: 1000,
        },
        'pickup-123',
        201,
      );

      expect(mockPost).toHaveBeenCalledWith('/parcels', {
        parcel: expect.objectContaining({
          request_label: true,
          shipment: { id: 201 },
          to_service_point: 'pickup-123',
        }),
      });
    });
  });
});
