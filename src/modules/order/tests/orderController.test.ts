const mockGetUserById = jest.fn();
const mockVerifySucceededPaymentIntentForUser = jest.fn();
const mockFinalizePendingOrder = jest.fn();
const mockUpdateOrder = jest.fn();
const mockReleaseOrderForPayout = jest.fn();
const mockScheduleFulfillmentRecovery = jest.fn();

jest.mock('../services/FulfillmentRecovery', () => ({
  scheduleFulfillmentRecovery: (...args: unknown[]) =>
    mockScheduleFulfillmentRecovery(...args),
}));
const mockCreateBuyerDispute = jest.fn();
const mockGetOrdersByUserId = jest.fn();
const mockGetOrderById = jest.fn();
const mockGetShipmentByOrderId = jest.fn();
const mockSendSellerLabelEmail = jest.fn();
const mockSendBuyerShipmentStartedEmail = jest.fn();
const mockProcessPaidOrder = jest.fn();
const mockRefundUnavailablePayment = jest.fn();

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
  })),
}));

jest.mock('../repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    finalizePendingOrder: mockFinalizePendingOrder,
    updateOrder: mockUpdateOrder,
    releaseOrderForPayout: mockReleaseOrderForPayout,
    getOrdersByUserId: mockGetOrdersByUserId,
    getOrderById: mockGetOrderById,
  })),
  FulfillmentJobBusyError: class FulfillmentJobBusyError extends Error {},
  PaymentOrderMismatchError: class PaymentOrderMismatchError extends Error {
    constructor() {
      super('Pending order does not match verified payment');
    }
  },
  PendingOrderUnavailableError: class PendingOrderUnavailableError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

jest.mock('../../../disputes/DisputeRepository', () => ({
  DisputeRepository: jest.fn().mockImplementation(() => ({
    createBuyerDispute: mockCreateBuyerDispute,
  })),
}));

jest.mock('../../payment/services/PaymentService', () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    verifySucceededPaymentIntentForUser:
      mockVerifySucceededPaymentIntentForUser,
    refundUnavailablePayment: mockRefundUnavailablePayment,
  })),
}));

jest.mock('../../shipping/repositories/ShipmentRepository', () => ({
  ShipmentRepository: jest.fn().mockImplementation(() => ({
    getShipmentByOrderId: mockGetShipmentByOrderId,
  })),
}));

jest.mock('../services/OrderFulfillmentService', () => ({
  OrderFulfillmentService: jest.fn().mockImplementation(() => ({
    processPaidOrder: mockProcessPaidOrder,
  })),
}));

jest.mock('../../notifications/services/EmailService', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendBuyerShipmentStartedEmail: mockSendBuyerShipmentStartedEmail,
  })),
}));

jest.mock('../../notifications/services/NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    sendSellerLabelEmail: mockSendSellerLabelEmail,
  })),
}));

import {
  confirmOrderReceived,
  createOrder,
  getMyOrderById,
  getMyOrders,
  submitOrderDispute,
} from '../controllers/orderController';

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
    mockGetUserById.mockImplementation((userId: string) => {
      if (userId === 'seller-1') {
        return Promise.resolve({
          id: 'seller-1',
          email: 'seller@example.com',
          displayName: 'Seller Name',
        });
      }

      return Promise.resolve({
        id: 'user-1',
        email: 'user@example.com',
        firstname: 'Jane',
        displayName: 'Jane Doe',
      });
    });
    mockVerifySucceededPaymentIntentForUser.mockResolvedValue({
      paymentIntentId: 'pi_123',
      firebaseUid: 'user-1',
      orderId: 'order-1',
      sellerId: 'seller-1',
      charityId: 'charity-1',
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
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      sellerId: 'seller-1',
      charityId: 'charity-1',
      paymentIntentId: 'pi_123',
      productId: 'product-1',
      productAmount: 2000,
      shippingFee: 399,
      securityFee: 200,
      totalAmount: 2599,
      shippingOptionId: '12345',
      shippingWeight: 2000,
      shippingCarrier: 'inpost_gb',
      pickupPoint: { id: '999' },
      status: 'pending_payment',
    });
    mockFinalizePendingOrder.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      sellerId: 'seller-1',
      charityId: 'charity-1',
      email: 'user@example.com',
      productName: 'Winter Coat',
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
      status: 'paid',
      ...payload,
      createdAt: new Date(),
    });
    mockRefundUnavailablePayment.mockResolvedValue(undefined);
    mockProcessPaidOrder.mockResolvedValue({
      shipment: {
        id: 'shipment-1',
        status: 'announced',
        labelUrl: 'https://labels.example/1.pdf',
        trackingNumber: 'TRACK123',
        trackingUrl: 'https://track.example/123',
        carrier: 'inpost_gb',
      },
      sendcloudParcel: { id: 99 },
      completed: true,
    });
    mockSendSellerLabelEmail.mockResolvedValue({
      sent: true,
      skipped: false,
    });
    mockSendBuyerShipmentStartedEmail.mockResolvedValue({
      sent: true,
      skipped: false,
    });
  });

  it('processes fulfillment directly after payment finalization', async () => {
    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockVerifySucceededPaymentIntentForUser).toHaveBeenCalledWith(
      'user-1',
      'pi_123',
    );
    expect(mockGetOrderById).toHaveBeenCalledWith('order-1');
    expect(mockFinalizePendingOrder).toHaveBeenCalledWith(
      'order-1',
      'pi_123',
      expect.objectContaining({
        userId: 'user-1',
        totalAmount: 2599,
        pickupPointId: '999',
      }),
    );
    expect(mockProcessPaidOrder).toHaveBeenCalledWith('order-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns a pending fulfillment response when processing needs retry', async () => {
    mockProcessPaidOrder.mockRejectedValue(
      new Error('Sendcloud unavailable'),
    );
    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockScheduleFulfillmentRecovery).toHaveBeenCalledWith('order-1');
  });

  it('does not schedule recovery when another worker holds the fulfillment job', async () => {
    const { FulfillmentJobBusyError } = jest.requireMock(
      '../repositories/OrderRepository',
    );
    mockProcessPaidOrder.mockRejectedValue(new FulfillmentJobBusyError());
    const res = createResponse();

    await createOrder(
      {
        user: { uid: 'user-1' },
        body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockScheduleFulfillmentRecovery).not.toHaveBeenCalled();
  });

  it('returns 400 when payment verification fails', async () => {
    mockVerifySucceededPaymentIntentForUser.mockRejectedValue(
      new Error('Payment has not succeeded'),
    );

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockFinalizePendingOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('refunds when the pending order differs from the paid checkout', async () => {
    const { PaymentOrderMismatchError } = jest.requireMock(
      '../repositories/OrderRepository',
    );
    mockFinalizePendingOrder.mockRejectedValue(
      new PaymentOrderMismatchError(),
    );

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockFinalizePendingOrder).toHaveBeenCalled();
    expect(mockRefundUnavailablePayment).toHaveBeenCalledWith(
      'order-1',
      'pi_123',
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refunds an expired successful payment and returns a conflict', async () => {
    const { PendingOrderUnavailableError } = jest.requireMock(
      '../repositories/OrderRepository',
    );
    mockFinalizePendingOrder.mockRejectedValue(
      new PendingOrderUnavailableError('expired'),
    );
    const req: any = {
      user: { uid: 'user-1' },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockRefundUnavailablePayment).toHaveBeenCalledWith(
      'order-1',
      'pi_123',
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYMENT_REFUNDED' }),
    );
  });

  it('returns 404 when the pending order no longer exists', async () => {
    mockGetOrderById.mockResolvedValue(null);

    const req: any = {
      user: {
        uid: 'user-1',
      },
      body: { orderId: 'order-1', paymentIntentId: 'pi_123' },
    };
    const res = createResponse();

    await createOrder(req, res);

    expect(mockFinalizePendingOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('orderController order retrieval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns enriched my-orders data with shipment details', async () => {
    mockGetOrdersByUserId.mockResolvedValue([
      {
        id: 'order-1',
        userId: 'user-1',
        email: 'user@example.com',
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
          name: 'Jane Doe',
          telephone: '+447700900000',
          address: {
            line1: '10 High Street',
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
        status: 'shipped',
        shipmentStatus: 'en_route',
        shipmentId: 'shipment-1',
        createdAt: new Date('2026-07-14T10:00:00.000Z'),
      },
    ]);
    mockGetShipmentByOrderId.mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
      provider: 'sendcloud',
      carrier: 'inpost_gb',
      status: 'en_route',
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/123',
      labelUrl: null,
      pickupPoint: {
        id: '999',
        name: 'Locker A',
      },
      createdAt: new Date('2026-07-14T10:05:00.000Z'),
      updatedAt: new Date('2026-07-14T12:00:00.000Z'),
    });

    const req: any = {
      user: {
        uid: 'user-1',
      },
    };
    const res = createResponse();

    await getMyOrders(req, res);

    expect(mockGetOrdersByUserId).toHaveBeenCalledWith('user-1');
    expect(mockGetShipmentByOrderId).toHaveBeenCalledWith('order-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          orders: [
            expect.objectContaining({
              id: 'order-1',
              paymentState: 'paid',
              deliveryState: 'shipped',
              deliveryLabel: 'On the way',
              canTrack: true,
              trackingNumber: 'TRACK123',
              trackingUrl: 'https://track.example/123',
              shipment: expect.objectContaining({
                id: 'shipment-1',
                status: 'en_route',
              }),
            }),
          ],
          count: 1,
        },
      }),
    );
  });

  it('returns a single enriched order for the owner', async () => {
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      email: 'user@example.com',
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
        name: 'Jane Doe',
        telephone: '+447700900000',
        address: {
          line1: '10 High Street',
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
      status: 'delivered',
      shipmentStatus: 'delivered',
      shipmentId: 'shipment-1',
      createdAt: new Date('2026-07-14T10:00:00.000Z'),
    });
    mockGetShipmentByOrderId.mockResolvedValue({
      id: 'shipment-1',
      orderId: 'order-1',
      provider: 'sendcloud',
      carrier: 'inpost_gb',
      status: 'delivered',
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/123',
      labelUrl: null,
      pickupPoint: {
        id: '999',
        name: 'Locker A',
      },
      createdAt: new Date('2026-07-14T10:05:00.000Z'),
      updatedAt: new Date('2026-07-14T12:00:00.000Z'),
    });

    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await getMyOrderById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          order: expect.objectContaining({
            id: 'order-1',
            deliveryState: 'awaiting_confirmation',
            deliveryLabel: 'Awaiting your confirmation',
            canTrack: true,
          }),
        },
      }),
    );
  });

  it('forbids access to another user’s order', async () => {
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'other-user',
    });

    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await getMyOrderById(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('orderController.confirmOrderReceived', () => {
  const shippedOrder = {
    id: 'order-1',
    userId: 'user-1',
    email: 'user@example.com',
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
      name: 'Jane Doe',
      telephone: '+447700900000',
      address: {
        line1: '10 High Street',
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
    status: 'shipped',
    shipmentStatus: 'en_route',
    shipmentId: 'shipment-1',
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetShipmentByOrderId.mockResolvedValue(null);
    mockReleaseOrderForPayout.mockResolvedValue({ status: 'released' });
  });

    it('lets the buyer confirm a delivered order as received', async () => {
      const deliveredOrder = {
        ...shippedOrder,
        status: 'delivered',
        shipmentStatus: 'delivered',
      };
      mockGetOrderById.mockResolvedValue(deliveredOrder);
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        buyerConfirmedReceived: true,
        status: 'delivered',
      }),
    );
    expect(mockUpdateOrder).toHaveBeenCalledWith(
      'order-1',
      expect.not.objectContaining({
        shipmentStatus: 'delivered',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Order receipt confirmed',
        data: {
          order: expect.objectContaining({
            id: 'order-1',
            buyerConfirmedReceived: true,
            deliveryState: 'confirmed',
            deliveryLabel: 'Confirmed',
            payoutStatus: 'ready_for_payout',
          }),
        },
      }),
    );
    expect(mockReleaseOrderForPayout).toHaveBeenCalledWith(
      'order-1',
      'buyer_confirmation',
    );
  });

  it('still confirms receipt when the payout release fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      status: 'delivered',
      shipmentStatus: 'delivered',
      payoutStatus: 'held',
    });
    mockReleaseOrderForPayout.mockRejectedValue(new Error('firestore down'));
    const res = createResponse();

    await confirmOrderReceived(
      { user: { uid: 'user-1' }, params: { id: 'order-1' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          order: expect.objectContaining({ payoutStatus: 'held' }),
        },
      }),
    );
    errorSpy.mockRestore();
  });

  it('does not confirm an order that has an open dispute', async () => {
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      status: 'delivered',
      shipmentStatus: 'delivered',
      buyerDisputeStatus: 'raised',
    });
    const res = createResponse();

    await confirmOrderReceived(
      { user: { uid: 'user-1' }, params: { id: 'order-1' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(mockReleaseOrderForPayout).not.toHaveBeenCalled();
  });

  it('forbids confirming another user’s order', async () => {
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      userId: 'other-user',
    });
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 when confirming an unknown order', async () => {
    mockGetOrderById.mockResolvedValue(null);
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'missing-order',
      },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects orders that are not ready for receipt confirmation', async () => {
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      status: 'paid',
      shipmentStatus: 'pending',
    });
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('rejects orders that have only been announced to the carrier', async () => {
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      status: 'shipment_created',
      shipmentStatus: 'announced',
    });
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('rejects orders that are still out for delivery', async () => {
    mockGetOrderById.mockResolvedValue({
      ...shippedOrder,
      shipmentStatus: 'out_for_delivery',
    });
    const req: any = {
      user: { uid: 'user-1' },
      params: { id: 'order-1' },
    };
    const res = createResponse();

    await confirmOrderReceived(req, res);

    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('orderController.submitOrderDispute', () => {
  const disputableOrder = {
    id: 'order-1',
    userId: 'user-1',
    email: 'user@example.com',
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
      name: 'Jane Doe',
      telephone: '+447700900000',
      address: {
        line1: '10 High Street',
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
    status: 'shipped',
    shipmentStatus: 'en_route',
    shipmentId: 'shipment-1',
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetShipmentByOrderId.mockResolvedValue(null);
    mockCreateBuyerDispute.mockResolvedValue({
      disputeId: 'dispute-generated-1',
      orderId: 'order-1',
      reason: 'wrong_item',
      status: 'raised',
      message: 'I received a different item.',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
    });
    mockGetOrderById.mockResolvedValue({
      ...disputableOrder,
      status: 'delivered',
      shipmentStatus: 'delivered',
      buyerDisputeStatus: 'raised',
    });
  });

    it('lets the buyer submit a dispute for a delivered order', async () => {
      const deliveredOrder = {
        ...disputableOrder,
        status: 'delivered',
        shipmentStatus: 'delivered',
      };
      mockGetOrderById.mockResolvedValue(deliveredOrder);
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
      body: {
        reason: 'wrong_item',
        message: 'I received a different item.',
      },
    };
    const res = createResponse();

    await submitOrderDispute(req, res);

    expect(mockCreateBuyerDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        buyerId: 'user-1',
        reason: 'wrong_item',
        message: 'I received a different item.',
      }),
    );
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Order dispute submitted',
        data: {
          order: expect.objectContaining({
            id: 'order-1',
            buyerDisputeId: 'dispute-generated-1',
            buyerDisputeReason: 'wrong_item',
            buyerDisputeStatus: 'raised',
            deliveryState: 'disputed',
            deliveryLabel: 'Disputed',
          }),
        },
      }),
    );
  });

  it('rejects an unsupported dispute reason', async () => {
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
      body: {
        reason: 'not_real',
      },
    };
    const res = createResponse();

    await submitOrderDispute(req, res);

    expect(mockGetOrderById).not.toHaveBeenCalled();
    expect(mockCreateBuyerDispute).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a dispute once the dispute window has closed', async () => {
    const { DisputeSubmissionError } = jest.requireActual(
      '../../../disputes/Dispute',
    );
    mockCreateBuyerDispute.mockRejectedValue(
      new DisputeSubmissionError('dispute_window_closed'),
    );
    const req: any = {
      user: {
        uid: 'user-1',
      },
      params: {
        id: 'order-1',
      },
      body: {
        reason: 'item_arrived_damaged',
      },
    };
    const res = createResponse();

    await submitOrderDispute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Dispute window closed' }),
    );
  });

  it('rejects a duplicate unresolved dispute', async () => {
    const { DisputeSubmissionError } = jest.requireActual(
      '../../../disputes/Dispute',
    );
    mockCreateBuyerDispute.mockRejectedValue(
      new DisputeSubmissionError('order_not_eligible'),
    );
    const req: any = {
      user: { uid: 'user-1' },
      params: { id: 'order-1' },
      body: { reason: 'wrong_item' },
    };
    const res = createResponse();

    await submitOrderDispute(req, res);

    expect(mockCreateBuyerDispute).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('rejects disputes before the order is delivered', async () => {
    const { DisputeSubmissionError } = jest.requireActual(
      '../../../disputes/Dispute',
    );
    mockCreateBuyerDispute.mockRejectedValue(
      new DisputeSubmissionError('order_not_eligible'),
    );
    const req: any = {
      user: { uid: 'user-1' },
      params: { id: 'order-1' },
      body: { reason: 'wrong_item' },
    };
    const res = createResponse();

    await submitOrderDispute(req, res);

    expect(mockCreateBuyerDispute).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
