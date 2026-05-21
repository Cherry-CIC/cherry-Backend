import { Order } from '../../order/model/Order';

jest.mock('../repositories/ShipmentRepository', () => ({
  ShipmentRepository: jest.fn(),
}));

import { ShipmentService } from '../services/ShipmentService';

const baseOrder: Order = {
  id: 'order-1',
  userId: 'user-1',
  email: 'buyer@example.com',
  amount: 2599,
  productId: 'product-1',
  productName: 'Winter Coat',
  deliveryType: 'pickup_point',
  shippingOptionId: '12345',
  shippingOptionName: 'InPost locker',
  shippingCarrier: 'inpost_gb',
  shippingWeight: 2500,
  shipping: {
    name: 'Jane Doe',
    telephone: '+447700900000',
    address: {
      line1: '10 Buyer Street',
      house_number: '10',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
  },
  pickupPoint: {
    id: '999',
    name: 'Locker A',
    addressLine1: '1 Locker Street',
    city: 'London',
    postalCode: 'SW1A 2AA',
    country: 'GB',
    carrier: 'inpost_gb',
  },
  paymentIntentId: 'pi_123',
  paymentStatus: 'succeeded',
  shipmentStatus: 'pending',
  status: 'completed',
  createdAt: new Date('2026-05-20T09:00:00.000Z'),
};

describe('ShipmentService', () => {
  it('creates a Sendcloud service-point parcel from the stored pickup-point snapshot', async () => {
    const shipmentRepository: any = {
      getShipmentByOrderId: jest.fn().mockResolvedValue(null),
      createShipment: jest.fn((shipment) =>
        Promise.resolve({
          id: 'shipment-1',
          ...shipment,
        }),
      ),
    };
    const sendcloudService: any = {
      createParcel: jest.fn().mockResolvedValue({
        id: 1001,
        tracking_number: 'TRACK123',
        tracking_url: 'https://track.example/1001',
        carrier: {
          name: 'InPost',
        },
        label: {
          label_printer: 'https://label.example/1001',
        },
      }),
    };
    const service = new ShipmentService(shipmentRepository, sendcloudService);

    const result = await service.createShipmentForPaidOrder(baseOrder);

    expect(sendcloudService.createParcel).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '1 Locker Street',
        house_number: '',
        city: 'London',
        postal_code: 'SW1A 2AA',
        country: 'GB',
        to_service_point: 999,
        shipment: {
          id: 12345,
        },
      }),
    );
    expect(shipmentRepository.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        deliveryType: 'pickup_point',
        shippingOptionId: '12345',
        pickupPoint: baseOrder.pickupPoint,
        parcel: expect.objectContaining({
          to_service_point: 999,
        }),
      }),
    );
    expect(result.shipment.id).toBe('shipment-1');
  });

  it('fails fast when a pickup-point order has an incomplete pickup point', async () => {
    const shipmentRepository: any = {
      getShipmentByOrderId: jest.fn().mockResolvedValue(null),
      createShipment: jest.fn(),
    };
    const sendcloudService: any = {
      createParcel: jest.fn(),
    };
    const service = new ShipmentService(shipmentRepository, sendcloudService);

    await expect(
      service.createShipmentForPaidOrder({
        ...baseOrder,
        pickupPoint: {
          ...baseOrder.pickupPoint!,
          postalCode: '',
        },
      }),
    ).rejects.toThrow('Pickup-point delivery requires a complete pickup point');

    expect(sendcloudService.createParcel).not.toHaveBeenCalled();
  });
});
