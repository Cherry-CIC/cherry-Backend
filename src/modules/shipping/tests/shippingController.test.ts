const mockGetDeliveryOptions = jest.fn();
const mockGetPickupPoints = jest.fn();
const mockGetShipmentBySendcloudId = jest.fn();
const mockApplyTrackingEvent = jest.fn();
const mockDispatchLockerReadyPush = jest.fn();
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
    applyTrackingEvent: mockApplyTrackingEvent,
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

jest.mock('../../notifications/services/LockerReadyPush', () => ({
  dispatchLockerReadyPush: mockDispatchLockerReadyPush,
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
    mockApplyTrackingEvent.mockResolvedValue({ updated: true, dispatchLockerReady: false });
    mockDispatchLockerReadyPush.mockResolvedValue(undefined);
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
      firstname: 'Buyer',
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

  it('acknowledges Sendcloud integration events without a parcel', async () => {
    const req: any = {
      body: {
        action: 'integration_updated',
        timestamp: 1793049749154,
        integration: {
          id: 562479,
          system: 'api',
        },
      },
    };
    const res = createResponse();

    await handleSendcloudWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockApplyTrackingEvent).not.toHaveBeenCalled();
    expect(mockUpdateOrder).not.toHaveBeenCalled();
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
    expect(mockDispatchLockerReadyPush).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('preserves the existing delivered email for a newly accepted delivery', async () => {
    mockGetShipmentBySendcloudId.mockResolvedValue({ id: 'shipment-1', orderId: 'order-1' });
    mockGetOrderById.mockResolvedValue({
      id: 'order-1', userId: 'user-1', email: 'buyer@example.com', productName: 'Winter Coat',
    });
    const req: any = { body: {
      action: 'parcel_status_changed', parcel: { id: 123, status: { message: 'Delivered' } },
    } };
    const res = createResponse();
    await handleSendcloudWebhook(req, res);

    expect(mockSendBuyerDeliveredEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'buyer@example.com', orderId: 'order-1',
    }));
    expect(mockDispatchLockerReadyPush).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('locker arrival', () => {
    const shipment = { id: 'shipment-1', orderId: 'order-1' };
    const request = {
      body: {
        action: 'parcel_status_changed',
        timestamp: 1793909100,
        carrier_status_change_timestamp: '2026-11-05T19:11:00Z',
        parcel: {
          id: 123,
          status: { message: 'Awaiting customer pickup' },
          is_return: false,
          to_service_point: 45,
        },
      },
    } as any;

    beforeEach(() => {
      mockGetShipmentBySendcloudId.mockResolvedValue(shipment);
      mockApplyTrackingEvent.mockResolvedValue({ updated: true, dispatchLockerReady: true });
    });

    it('uses the carrier arrival details and sends only the collection push', async () => {
      const res = createResponse();
      await handleSendcloudWebhook(request, res);

      expect(mockApplyTrackingEvent).toHaveBeenCalledWith(
        shipment, expect.objectContaining({ status: 'en_route' }),
        expect.objectContaining({ status: 'shipped' }), new Date(request.body.timestamp * 1000),
        {
          message: 'Awaiting customer pickup',
          carrierTime: new Date('2026-11-05T19:11:00Z'),
          isReturn: false,
          servicePointId: 45,
        },
      );
      expect(mockDispatchLockerReadyPush).toHaveBeenCalledTimes(1);
      expect(mockDispatchLockerReadyPush).toHaveBeenCalledWith(shipment.id);
      expect(mockSendBuyerDeliveredEmail).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns a retryable response if dispatch fails after recording the arrival', async () => {
      mockDispatchLockerReadyPush.mockRejectedValueOnce(new Error('Delivery incomplete'));
      const firstResponse = createResponse();
      await handleSendcloudWebhook(request, firstResponse);
      expect(firstResponse.status).toHaveBeenCalledWith(500);

      mockApplyTrackingEvent.mockResolvedValue({ updated: false, dispatchLockerReady: true });
      const retryResponse = createResponse();
      await handleSendcloudWebhook(request, retryResponse);
      expect(mockDispatchLockerReadyPush).toHaveBeenCalledTimes(2);
      expect(retryResponse.status).toHaveBeenCalledWith(200);
      expect(mockSendBuyerDeliveredEmail).not.toHaveBeenCalled();
    });
  });
});
