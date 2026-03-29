const mockGetDeliveryOptions = jest.fn();
const mockGetPickupPoints = jest.fn();
const mockGetShipmentBySendcloudId = jest.fn();
const mockUpdateShipment = jest.fn();
const mockUpdateOrder = jest.fn();

jest.mock('../services/CheckoutShippingService', () => ({
  CheckoutShippingService: jest.fn().mockImplementation(() => ({
    getDeliveryOptions: mockGetDeliveryOptions,
    getPickupPoints: mockGetPickupPoints,
  })),
}));

jest.mock('../repositories/ShipmentRepository', () => ({
  ShipmentRepository: jest.fn().mockImplementation(() => ({
    getShipmentBySendcloudId: mockGetShipmentBySendcloudId,
    updateShipment: mockUpdateShipment,
    getShipmentByOrderId: jest.fn(),
    getAllShipments: jest.fn(),
  })),
}));

jest.mock('../../order/repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    updateOrder: mockUpdateOrder,
    getOrderById: jest.fn(),
    getAllOrders: jest.fn(),
  })),
}));

import {
  getCheckoutShippingOptions,
  getPickupPoints,
  handleSendcloudWebhook,
} from '../controllers/shippingController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('shippingController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns checkout shipping options', async () => {
    mockGetDeliveryOptions.mockResolvedValue([
      {
        id: 'opt_1',
        name: 'Home delivery',
        deliveryType: 'home',
      },
    ]);

    const req: any = {
      query: {
        country: 'GB',
        postalCode: 'SW1A 1AA',
        weight: '2500',
        value: '45.90',
      },
    };
    const res = createResponse();

    await getCheckoutShippingOptions(req, res);

    expect(mockGetDeliveryOptions).toHaveBeenCalledWith({
      country: 'GB',
      postalCode: 'SW1A 1AA',
      weight: 2500,
      value: '45.90',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          options: [
            expect.objectContaining({
              id: 'opt_1',
            }),
          ],
        },
      })
    );
  });

  it('returns pickup points', async () => {
    mockGetPickupPoints.mockResolvedValue([
      {
        id: 'sp_1',
        name: 'Locker A',
      },
    ]);

    const req: any = {
      query: {
        country: 'GB',
        postalCode: 'SW1A 1AA',
        carrier: 'postnl',
      },
    };
    const res = createResponse();

    await getPickupPoints(req, res);

    expect(mockGetPickupPoints).toHaveBeenCalledWith({
      country: 'GB',
      postalCode: 'SW1A 1AA',
      city: undefined,
      address: undefined,
      houseNumber: undefined,
      weight: undefined,
      carrier: 'postnl',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates shipment and order state from a webhook', async () => {
    mockGetShipmentBySendcloudId.mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
      status: 'announced',
    });

    const req: any = {
      body: {
        action: 'parcel_status_changed',
        timestamp: '2026-03-28T12:00:00Z',
        parcel: {
          id: 123,
          tracking_number: 'TRACK123',
          tracking_url: 'https://track.example/123',
          status: {
            message: 'Delivered',
          },
        },
      },
    };
    const res = createResponse();

    await handleSendcloudWebhook(req, res);

    expect(mockUpdateShipment).toHaveBeenCalledWith('shipment-1', {
      status: 'delivered',
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/123',
    });
    expect(mockUpdateOrder).toHaveBeenCalledWith('order-1', {
      shipmentStatus: 'delivered',
      shipmentId: 'shipment-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
