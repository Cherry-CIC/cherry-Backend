const mockGetUserById = jest.fn();
const mockVerifySucceededPaymentIntentForUser = jest.fn();
const mockGetDeliveryOptions = jest.fn();
const mockCreateOrder = jest.fn();
const mockUpdateOrder = jest.fn();
const mockCreateShipmentForPaidOrder = jest.fn();

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
  })),
}));

jest.mock('../repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    createOrder: mockCreateOrder,
    updateOrder: mockUpdateOrder,
  })),
}));

jest.mock('../../payment/services/PaymentService', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    verifySucceededPaymentIntentForUser: mockVerifySucceededPaymentIntentForUser,
  })),
}));

jest.mock('../../shipping/services/CheckoutShippingService', () => ({
  CheckoutShippingService: jest.fn().mockImplementation(() => ({
    getDeliveryOptions: mockGetDeliveryOptions,
  })),
}));

jest.mock('../../shipping/services/ShipmentService', () => ({
  ShipmentService: jest.fn().mockImplementation(() => ({
    createShipmentForPaidOrder: mockCreateShipmentForPaidOrder,
  })),
}));

import { createOrder } from '../controllers/orderController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('orderController.createOrder', () => {
  const payload = {
    amount: 2599,
    paymentIntentId: 'pi_123',
    productId: 'product-1',
    productName: 'Winter Coat',
    shippingMethodId: '12345',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 2500,
    shipping: {
      name: 'Jane Doe',
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserById.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Jane Doe',
    });
    mockVerifySucceededPaymentIntentForUser.mockResolvedValue({
      id: 'pi_123',
      status: 'succeeded',
    });
    mockGetDeliveryOptions.mockResolvedValue([
      {
        id: '12345',
        name: 'InPost locker',
        price: '3.99',
      },
    ]);
  });

  it('creates a paid order and shipment', async () => {
    mockCreateOrder.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      email: 'user@example.com',
      ...payload,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'completed',
      createdAt: new Date(),
    });
    mockCreateShipmentForPaidOrder.mockResolvedValue({
      shipment: {
        id: 'shipment-1',
        status: 'announced',
      },
      sendcloudParcel: {
        id: 99,
      },
    });

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockVerifySucceededPaymentIntentForUser).toHaveBeenCalledWith(
      'user-1',
      'pi_123',
      2599,
    );
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingOptionId: '12345',
        shippingOptionName: 'InPost locker',
        shippingOptionPrice: '3.99',
      }),
    );
    expect(mockUpdateOrder).toHaveBeenCalledWith('order-1', {
      shipmentId: 'shipment-1',
      shipmentStatus: 'announced',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 202 when shipment creation fails after order creation', async () => {
    mockCreateOrder.mockResolvedValue({
      id: 'order-2',
      userId: 'user-1',
      email: 'user@example.com',
      ...payload,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'completed',
      createdAt: new Date(),
    });
    mockCreateShipmentForPaidOrder.mockRejectedValue(
      new Error('Sendcloud unavailable'),
    );

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockUpdateOrder).toHaveBeenCalledWith('order-2', {
      shipmentStatus: 'pending',
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Order created, shipment pending',
      }),
    );
  });

  it('returns 400 when payment verification fails', async () => {
    mockVerifySucceededPaymentIntentForUser.mockRejectedValue(
      new Error('Payment has not succeeded'),
    );

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when shipping method is invalid for pickup point', async () => {
    mockGetDeliveryOptions.mockResolvedValue([
      {
        id: '99999',
        name: 'Another method',
        price: '4.99',
      },
    ]);

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
