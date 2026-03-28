const mockGetUserById = jest.fn();
const mockVerifySucceededPaymentIntentForUser = jest.fn();
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
    deliveryType: 'home' as const,
    shippingOptionId: '12345',
    shippingOptionName: 'Home delivery',
    shippingOptionPrice: '3.99',
    shippingCarrier: 'evri',
    shippingWeight: 2500,
    shipping: {
      name: 'Jane Doe',
      address: {
        line1: '10 High Street',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
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
    expect(mockCreateOrder).toHaveBeenCalled();
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
});
