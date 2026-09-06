const mockGetDeliveryOptions = jest.fn();
const mockGetPickupPoints = jest.fn();
const mockGetShipmentBySendcloudId = jest.fn();
const mockUpdateShipment = jest.fn();
const mockUpdateOrder = jest.fn();
const mockGetOrderById = jest.fn();
const mockGetUserById = jest.fn();
const mockGetProductById = jest.fn();
const mockGetPostageSizeById = jest.fn();
const mockSendBuyerDeliveredEmail = jest.fn();

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
    getOrderById: mockGetOrderById,
    getAllOrders: jest.fn(),
  })),
}));

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
  })),
}));

jest.mock('../../notifications/services/EmailService', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendBuyerDeliveredEmail: mockSendBuyerDeliveredEmail,
  })),
}));

jest.mock('../../products/repositories/ProductRepository', () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetProductById,
  })),
}));

jest.mock('../../postage-sizes/repositories/PostageSizeRepository', () => ({
  PostageSizeRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetPostageSizeById,
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
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      postageSize: 'postage-size-1',
    });
    mockGetPostageSizeById.mockResolvedValue({
      id: 'postage-size-1',
      weight: 2000,
    });
    mockGetOrderById.mockResolvedValue(null);
    mockGetUserById.mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
      displayName: 'Buyer Name',
    });
    mockSendBuyerDeliveredEmail.mockResolvedValue({
      sent: true,
      skipped: false,
    });
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
        productId: 'product-1',
        servicePointId: '12345678',
        country: 'GB',
        postalCode: 'SW1A 1AA',
      },
    };
    const res = createResponse();

    await getCheckoutShippingOptions(req, res);

    expect(mockGetDeliveryOptions).toHaveBeenCalledWith({
      servicePointId: '12345678',
      country: 'GB',
      postalCode: 'SW1A 1AA',
      weightGrams: 2000,
      isReturn: undefined,
      carrier: 'inpost_gb',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          shippingMethods: [
            expect.objectContaining({
              id: 'opt_1',
            }),
          ],
        },
      }),
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
        address: 'SW1A 1AA',
      },
    };
    const res = createResponse();

    await getPickupPoints(req, res);

    expect(mockGetPickupPoints).toHaveBeenCalledWith({
      country: 'GB',
      address: 'SW1A 1AA',
      radius: undefined,
      carrier: 'inpost_gb',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates shipment and order state from a webhook', async () => {
    mockGetShipmentBySendcloudId.mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
      status: 'announced',
    });
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      email: 'buyer@example.com',
      productName: 'Winter Coat',
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
      status: 'delivered',
    });
    expect(mockSendBuyerDeliveredEmail).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      buyerName: 'Buyer Name',
      productName: 'Winter Coat',
      orderId: 'order-1',
    });
    expect(mockUpdateOrder).toHaveBeenCalledWith('order-1', {
      buyerDeliveryEmailSentAt: expect.any(Date),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not resend delivered email when it was already sent', async () => {
    mockGetShipmentBySendcloudId.mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
      status: 'announced',
    });
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      email: 'buyer@example.com',
      productName: 'Winter Coat',
      buyerDeliveryEmailSentAt: new Date(),
    });

    const req: any = {
      body: {
        action: 'parcel_status_changed',
        parcel: {
          id: 123,
          status: {
            message: 'Delivered',
          },
        },
      },
    };
    const res = createResponse();

    await handleSendcloudWebhook(req, res);

    expect(mockSendBuyerDeliveredEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
