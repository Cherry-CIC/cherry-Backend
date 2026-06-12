const mockGetUserById = jest.fn();
const mockVerifySucceededPaymentIntentForUser = jest.fn();
const mockGetDeliveryOptions = jest.fn();
const mockCreatePaidOrderAndDecrementInventory = jest.fn();
const mockUpdateOrder = jest.fn();
const mockCreateShipmentForPaidOrder = jest.fn();
const mockGetProductById = jest.fn();
const mockGetPostageSizeById = jest.fn();

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
  })),
}));

jest.mock('../repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    createPaidOrderAndDecrementInventory: mockCreatePaidOrderAndDecrementInventory,
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

import { createOrder } from '../controllers/orderController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('orderController.createOrder', () => {
  const payload = {
    productId: 'product-1',
    paymentIntentId: 'pi_123',
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
      paymentIntentId: 'pi_123',
      firebaseUid: 'user-1',
      productId: 'product-1',
      shippingMethodId: '12345',
      shippingMethodName: 'InPost locker',
      pickupPointId: '999',
      destinationCountry: 'GB',
      destinationPostalCode: 'SW1A 1AA',
      shippingCarrier: 'inpost_gb',
      shippingWeight: 2000,
      productAmount: 2000,
      shippingFee: 399,
      securityFee: 200,
      totalAmount: 2599,
      currency: 'GBP',
    });
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      name: 'Winter Coat',
      postageSize: 'postage-size-1',
    });
    mockGetPostageSizeById.mockResolvedValue({
      id: 'postage-size-1',
      size: 'large',
      type: 'inpost',
      description: 'Large parcel',
      weight: 2000,
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
    mockCreatePaidOrderAndDecrementInventory.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      email: 'user@example.com',
      ...payload,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'paid',
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
    );
    expect(mockCreatePaidOrderAndDecrementInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: 'Winter Coat',
        shippingWeight: 2000,
        productAmount: 2000,
        shippingFee: 399,
        securityFee: 200,
        totalAmount: 2599,
        shippingOptionId: '12345',
        shippingOptionName: 'InPost locker',
      }),
    );
    expect(mockUpdateOrder).toHaveBeenCalledWith('order-1', {
      shipmentId: 'shipment-1',
      shipmentStatus: 'announced',
      status: 'shipment_created',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 202 when shipment creation fails after order creation', async () => {
    mockCreatePaidOrderAndDecrementInventory.mockResolvedValue({
      id: 'order-2',
      userId: 'user-1',
      email: 'user@example.com',
      ...payload,
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'paid',
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
      status: 'shipment_pending',
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

    expect(mockCreatePaidOrderAndDecrementInventory).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when pickup point differs from the paid checkout', async () => {
    mockVerifySucceededPaymentIntentForUser.mockResolvedValue({
      paymentIntentId: 'pi_123',
      firebaseUid: 'user-1',
      productId: 'product-1',
      shippingMethodId: '12345',
      shippingMethodName: 'InPost locker',
      pickupPointId: 'different-pickup-point',
      destinationCountry: 'GB',
      destinationPostalCode: 'SW1A 1AA',
      shippingCarrier: 'inpost_gb',
      shippingWeight: 2000,
      productAmount: 2000,
      shippingFee: 399,
      securityFee: 200,
      totalAmount: 2599,
      currency: 'GBP',
    });

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockCreatePaidOrderAndDecrementInventory).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when the product postage size does not exist', async () => {
    mockGetPostageSizeById.mockResolvedValue(null);

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: payload,
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockCreatePaidOrderAndDecrementInventory).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
