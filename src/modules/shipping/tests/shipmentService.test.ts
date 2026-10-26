const sendcloudConfigMock = {
  labelMode: 'test',
  enforcedCarrier: 'inpost_gb',
};

jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: sendcloudConfigMock,
}));

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
}));

import { ShipmentService } from '../services/ShipmentService';
import { Order } from '../../order/model/Order';

describe('ShipmentService.createShipmentForPaidOrder', () => {
  const order: Order = {
    id: 'order-1',
    userId: 'buyer-1',
    sellerId: 'seller-1',
    charityId: 'charity-1',
    email: 'buyer@example.com',
    productAmount: 2000,
    shippingFee: 399,
    securityFee: 200,
    totalAmount: 2599,
    currency: 'GBP',
    productId: 'product-1',
    productName: 'Winter Coat',
    deliveryType: 'pickup_point',
    shippingOptionId: '12345',
    shippingOptionName: 'InPost locker',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 2000,
    shipping: {
      name: 'Buyer Name',
      telephone: '+447700900000',
      address: {
        line1: '10 High Street',
        house_number: '10',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
    },
    pickupPoint: {
      id: '999',
      name: 'Locker A',
      addressLine1: '10 High Street',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
      carrier: 'inpost_gb',
    },
    paymentIntentId: 'pi_123',
    paymentStatus: 'succeeded',
    status: 'paid',
    shipmentStatus: 'pending',
    createdAt: new Date(),
  };

  const createService = () => {
    const shipmentRepository = {
      getShipmentByOrderId: jest.fn().mockResolvedValue(null),
      createShipment: jest.fn(async (shipment) => ({
        id: 'shipment-1',
        ...shipment,
      })),
    };
    const sendcloudService = {
      findParcelByOrderNumber: jest.fn().mockResolvedValue(null),
      createParcel: jest.fn().mockResolvedValue({
        id: 99,
        tracking_number: 'TRACK123',
        tracking_url: 'https://track.example/123',
        carrier: { name: 'inpost_gb' },
        label: {
          normal_printer: ['https://labels.example/normal.pdf'],
          label_printer: 'https://labels.example/label.pdf',
        },
        documents: [
          {
            type: 'qr',
            size: 'a6',
            link: 'https://labels.example/qr.pdf',
          },
        ],
      }),
    };

    return {
      shipmentRepository,
      sendcloudService,
      service: new ShipmentService(
        shipmentRepository as any,
        sendcloudService as any,
      ),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sendcloudConfigMock.labelMode = 'test';
  });

  it('uses the Sendcloud test label method without a service point in test mode', async () => {
    const { service, sendcloudService, shipmentRepository } = createService();

    await service.createShipmentForPaidOrder(order);

    expect(sendcloudService.createParcel).toHaveBeenCalledWith(
      expect.objectContaining({
        request_label: true,
        email: 'buyer@example.com',
        shipment: {
          id: 8,
          name: 'Unstamped letter',
        },
      }),
    );
    expect(sendcloudService.createParcel).toHaveBeenCalledWith(
      expect.not.objectContaining({
        to_service_point: expect.anything(),
      }),
    );
    expect(shipmentRepository.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        labelUrl: 'https://labels.example/qr.pdf',
        trackingNumber: 'TRACK123',
        trackingUrl: 'https://track.example/123',
      }),
    );
  });

  it('uses the selected shipping method in live mode', async () => {
    sendcloudConfigMock.labelMode = 'live';
    const { service, sendcloudService } = createService();

    await service.createShipmentForPaidOrder(order);

    expect(sendcloudService.createParcel).toHaveBeenCalledWith(
      expect.objectContaining({
        request_label: true,
        shipment: {
          id: 12345,
          name: 'InPost locker',
        },
        to_service_point: 999,
      }),
    );
  });

  it('recovers an existing Sendcloud parcel instead of creating a duplicate', async () => {
    const { service, sendcloudService, shipmentRepository } = createService();
    sendcloudService.findParcelByOrderNumber.mockResolvedValue({
      id: 101,
      order_number: 'order-1',
      tracking_number: 'RECOVERED123',
      tracking_url: 'https://track.example/recovered',
      carrier: { name: 'inpost_gb' },
    });

    const result = await service.createShipmentForPaidOrder(order);

    expect(sendcloudService.findParcelByOrderNumber).toHaveBeenCalledWith(
      'order-1',
    );
    expect(sendcloudService.createParcel).not.toHaveBeenCalled();
    expect(shipmentRepository.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        sendcloudId: 101,
        trackingNumber: 'RECOVERED123',
      }),
    );
    expect(result.sendcloudParcel).toEqual(
      expect.objectContaining({ id: 101 }),
    );
  });
});
