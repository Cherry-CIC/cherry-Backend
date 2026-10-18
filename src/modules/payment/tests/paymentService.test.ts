const mockGetPendingOrdersForProduct = jest.fn();
const mockCreatePaymentIntentForUser = jest.fn();
const mockGetOrCreateCustomerId = jest.fn();
const mockCancelPaymentIntent = jest.fn();
const mockGetOrderById = jest.fn();
const mockGetUserById = jest.fn();
const mockGetProductById = jest.fn();
const mockGetPostageSizeById = jest.fn();
const mockGetDeliveryOptions = jest.fn();
const mockRetrievePaymentIntent = jest.fn();
const mockCreatePendingOrder = jest.fn();
const mockAttachPaymentIntent = jest.fn();
const mockReleasePendingOrder = jest.fn();
const mockFinalizePendingOrder = jest.fn();
const mockMarkPaymentRefunded = jest.fn();
const mockProcessPaidOrder = jest.fn();

jest.mock('../PaymentRepository', () => ({
  PaymentRepository: jest.fn().mockImplementation(() => ({
    createPaymentIntentForUser: mockCreatePaymentIntentForUser,
    getOrCreateCustomerId: mockGetOrCreateCustomerId,
  })),
}));

jest.mock('../../../shared/config/checkoutConfig', () => ({
  calculateSecurityFeePence: (productAmountPence: number) =>
    Math.round(productAmountPence * 0.1),
}));

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
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

jest.mock('../../shipping/services/CheckoutShippingService', () => ({
  CheckoutShippingService: jest.fn().mockImplementation(() => ({
    getDeliveryOptions: mockGetDeliveryOptions,
  })),
}));

jest.mock('../../../shared/config/stripeConfig', () => ({
  stripe: {
    paymentIntents: {
      retrieve: mockRetrievePaymentIntent,
      cancel: mockCancelPaymentIntent,
    },
    refunds: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../order/repositories/OrderRepository', () => ({
  OrderRepository: jest.fn().mockImplementation(() => ({
    createPendingOrder: mockCreatePendingOrder,
    getOrderById: mockGetOrderById,
    getPendingOrdersForProduct: mockGetPendingOrdersForProduct,
    attachPaymentIntent: mockAttachPaymentIntent,
    releasePendingOrder: mockReleasePendingOrder,
    finalizePendingOrder: mockFinalizePendingOrder,
    markPaymentRefunded: mockMarkPaymentRefunded,
  })),
  PendingOrderUnavailableError: class PendingOrderUnavailableError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
  PaymentOrderMismatchError: class PaymentOrderMismatchError extends Error {},
  FulfillmentJobBusyError: class FulfillmentJobBusyError extends Error {},
}));

jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    enforcedCarrier: 'inpost_gb',
  },
}));

jest.mock('../../order/services/OrderFulfillmentService', () => ({
  OrderFulfillmentService: jest.fn().mockImplementation(() => ({
    processPaidOrder: mockProcessPaidOrder,
  })),
}));

import { PaymentService } from '../services/PaymentService';
import { PendingOrderUnavailableError } from '../../order/repositories/OrderRepository';

describe('PaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetrievePaymentIntent.mockReset();
    mockCancelPaymentIntent.mockReset();
    mockGetPendingOrdersForProduct.mockResolvedValue([]);
    mockGetUserById.mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
    });
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      price: 25,
      number: 1,
      postageSize: 'postage-size-1',
      userId: 'seller-1',
      charityId: 'charity-1',
    });
    mockGetPostageSizeById.mockResolvedValue({
      id: 'postage-size-1',
      weight: 2000,
    });
    mockGetDeliveryOptions.mockResolvedValue([
      {
        id: '3747',
        name: 'InPost locker',
        pricePence: 399,
        currency: 'GBP',
      },
    ]);
    mockCreatePaymentIntentForUser.mockResolvedValue({
      paymentIntentId: 'pi_123',
      clientSecret: 'secret',
    });
    mockGetOrCreateCustomerId.mockResolvedValue('cus_buyer');
    mockCreatePendingOrder.mockImplementation(async (id, input) => ({
      ...input,
      id,
      createdAt: new Date(),
    }));
    mockGetOrderById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      productId: 'product-1',
      paymentIntentId: 'pi_123',
    });
    mockAttachPaymentIntent.mockResolvedValue(undefined);
    mockReleasePendingOrder.mockResolvedValue(undefined);
    mockFinalizePendingOrder.mockResolvedValue(undefined);
    mockMarkPaymentRefunded.mockResolvedValue(undefined);
    mockProcessPaidOrder.mockResolvedValue({ completed: true });
  });

  it('calculates the total from trusted product and shipping data', async () => {
    const service = new PaymentService();

    const result = await service.createPaymentIntentForUserByUid(
      'user-1',
      'allocated-order-id',
      {
        productId: 'product-1',
        shippingMethodId: '3747',
        pickupPointId: '13127548',
        country: 'GB',
        postalCode: 'SE18 4QH',
        shipping: {
          address: {
            line1: '1 Example Street',
            city: 'London',
            postal_code: 'SE18 4QH',
            country: 'GB',
          },
          name: 'Customer',
          telephone: '07123456789',
        },
        pickupPoint: {
          id: '13127548',
          name: 'Locker',
          addressLine1: '2 Example Street',
          city: 'London',
          postalCode: 'SE18 4QH',
          country: 'GB',
          carrier: 'inpost_gb',
        },
      },
    );

    expect(mockCreatePaymentIntentForUser).toHaveBeenCalledWith(
      3149,
      expect.objectContaining({
        firebaseUid: 'user-1',
        orderId: 'allocated-order-id',
        sellerId: 'seller-1',
        charityId: 'charity-1',
        productId: 'product-1',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      }),
      'cus_buyer',
      undefined,
    );
    expect(mockCreatePendingOrder).toHaveBeenCalledWith(
      'allocated-order-id',
      expect.objectContaining({
        userId: 'user-1',
        sellerId: 'seller-1',
        charityId: 'charity-1',
        productAmount: 2500,
        totalAmount: 3149,
      }),
      undefined,
    );
    expect(result).toEqual(
      expect.objectContaining({
        productAmount: 2500,
        shippingFee: 399,
        securityFee: 250,
        totalAmount: 3149,
        currency: 'GBP',
        orderId: 'allocated-order-id',
      }),
    );
  });

  it('verifies a succeeded PaymentIntent and parses trusted metadata', async () => {
    mockRetrievePaymentIntent.mockResolvedValue({
      id: 'pi_123',
      status: 'succeeded',
      currency: 'gbp',
      amount: 3149,
      metadata: {
        firebaseUid: 'user-1',
        orderId: 'order-1',
        sellerId: 'seller-1',
        charityId: 'charity-1',
        productId: 'product-1',
        shippingMethodId: '3747',
        shippingMethodName: 'InPost locker',
        pickupPointId: '13127548',
        destinationCountry: 'GB',
        destinationPostalCode: 'SE18 4QH',
        shippingCarrier: 'inpost_gb',
        shippingWeight: '2000',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      },
    });

    const service = new PaymentService();
    const result = await service.verifySucceededPaymentIntentForUser(
      'user-1',
      'pi_123',
    );

    expect(result).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        shippingMethodId: '3747',
        shippingWeight: 2000,
        totalAmount: 3149,
      }),
    );
  });

  it('finalizes an order from a succeeded webhook', async () => {
    const succeededIntent = {
      id: 'pi_123',
      status: 'succeeded',
      currency: 'gbp',
      amount: 3149,
      metadata: {
        firebaseUid: 'user-1',
        orderId: 'order-1',
        sellerId: 'seller-1',
        charityId: 'charity-1',
        productId: 'product-1',
        shippingMethodId: '3747',
        shippingMethodName: 'InPost locker',
        pickupPointId: '13127548',
        destinationCountry: 'GB',
        destinationPostalCode: 'SE18 4QH',
        shippingCarrier: 'inpost_gb',
        shippingWeight: '2000',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      },
    };
    mockRetrievePaymentIntent.mockResolvedValue(succeededIntent);

    await new PaymentService().handleSucceededPaymentIntent('pi_123');

    expect(mockFinalizePendingOrder).toHaveBeenCalledWith(
      'order-1',
      'pi_123',
      expect.objectContaining({
        userId: 'user-1',
        totalAmount: 3149,
        pickupPointId: '13127548',
      }),
    );
    expect(mockProcessPaidOrder).toHaveBeenCalledWith('order-1');
  });

  it('releases the reserved stock after a canceled PaymentIntent', async () => {
    mockRetrievePaymentIntent.mockResolvedValue({
      status: 'canceled',
      metadata: {
        firebaseUid: 'user-1',
        orderId: 'order-1',
        productId: 'product-1',
      },
    });
    await new PaymentService().handleCanceledPaymentIntent('pi_123', 'order-1');

    expect(mockReleasePendingOrder).toHaveBeenCalledWith('order-1', 'pi_123');
  });

  it('refunds a succeeded payment when its reservation is no longer usable', async () => {
    mockRetrievePaymentIntent.mockResolvedValue({
      id: 'pi_123',
      status: 'succeeded',
      currency: 'gbp',
      amount: 3149,
      metadata: {
        firebaseUid: 'user-1',
        orderId: 'order-1',
        sellerId: 'seller-1',
        charityId: 'charity-1',
        productId: 'product-1',
        shippingMethodId: '3747',
        shippingMethodName: 'InPost locker',
        pickupPointId: '13127548',
        destinationCountry: 'GB',
        destinationPostalCode: 'SE18 4QH',
        shippingCarrier: 'inpost_gb',
        shippingWeight: '2000',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      },
    });
    mockFinalizePendingOrder.mockRejectedValue(
      new PendingOrderUnavailableError('expired'),
    );

    await new PaymentService().handleSucceededPaymentIntent('pi_123');

    const { stripe } = jest.requireMock('../../../shared/config/stripeConfig');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_123' },
      { idempotencyKey: 'late-checkout-refund-pi_123' },
    );
    expect(mockMarkPaymentRefunded).toHaveBeenCalledWith('order-1', 'pi_123');
    expect(mockProcessPaidOrder).not.toHaveBeenCalled();
  });
  const selection = {
    productId: 'product-1',
    shippingMethodId: '3747',
    pickupPointId: '123',
    country: 'GB',
    postalCode: 'SW1A 1AA',
    shipping: {
      name: 'Customer',
      telephone: '07700900001',
      address: {
        line1: '1 High Street',
        city: 'London',
        country: 'GB',
        postal_code: 'SW1A 1AA',
      },
    },
    pickupPoint: {
      id: '123',
      name: 'Locker',
      addressLine1: '1 High Street',
      city: 'London',
      country: 'GB',
      postalCode: 'SW1A 1AA',
    },
  };

  it.each(['creation', 'attachment'])(
    'retains the order on ambiguous %s failure',
    async (stage) => {
      (stage === 'creation'
        ? mockCreatePaymentIntentForUser
        : mockAttachPaymentIntent
      ).mockRejectedValue(new Error('Timeout'));
      await expect(
        new PaymentService().createPaymentIntentForUserByUid(
          'user-1',
          'order-1',
          selection,
        ),
      ).rejects.toThrow('Timeout');
      expect(mockReleasePendingOrder).not.toHaveBeenCalled();
    },
  );

  it('uses the returned pending order identity and frozen Stripe arguments for retry', async () => {
    mockCreatePendingOrder.mockImplementation(async (_id, input) => ({
      ...input,
      id: 'original-order',
      createdAt: new Date(),
      stripeCustomerId: 'original-customer',
      paymentIntentId: 'pi_original',
    }));
    await new PaymentService().createPaymentIntentForUserByUid(
      'user-1',
      'new-id',
      selection,
    );
    expect(mockCreatePaymentIntentForUser).toHaveBeenCalledWith(
      3149,
      expect.objectContaining({ orderId: 'original-order' }),
      'original-customer',
      'pi_original',
    );
    expect(mockAttachPaymentIntent).toHaveBeenCalledWith(
      'original-order',
      'pi_123',
    );
  });

  it('does not recreate an uncertain intent after the idempotency recovery window', async () => {
    mockCreatePendingOrder.mockImplementation(async (id, input) => ({
      ...input,
      id,
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    }));
    await expect(
      new PaymentService().createPaymentIntentForUserByUid(
        'user-1',
        'order-1',
        selection,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(mockCreatePaymentIntentForUser).not.toHaveBeenCalled();
    expect(mockReleasePendingOrder).not.toHaveBeenCalled();
  });

  it('rejects a stale reviewed revision before creating an order or Stripe intent', async () => {
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      editVersion: 3,
    });
    await expect(
      new PaymentService().createPaymentIntentForUserByUid(
        'user-1',
        'order-1',
        { ...selection, expectedEditVersion: 2 },
      ),
    ).rejects.toMatchObject({ code: 'LISTING_VERSION_CONFLICT' });
    expect(mockCreatePendingOrder).not.toHaveBeenCalled();
  });

  it('requires a reviewed revision for an edited listing', async () => {
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      editVersion: 3,
      hasBeenEdited: true,
    });
    await expect(
      new PaymentService().createPaymentIntentForUserByUid(
        'user-1',
        'order-1',
        selection,
      ),
    ).rejects.toMatchObject({ code: 'LISTING_VERSION_REQUIRED' });
  });

  it.each(['succeeded', 'processing'])(
    'does not cancel or release a %s payment',
    async (status) => {
      mockRetrievePaymentIntent.mockResolvedValue({
        status,
        metadata: {
          firebaseUid: 'user-1',
          orderId: 'order-1',
          productId: 'product-1',
        },
      });
      await expect(
        new PaymentService().cancelPaymentIntentForUser('user-1', 'pi_123'),
      ).rejects.toMatchObject({ code: 'PAYMENT_STILL_ACTIONABLE' });
      expect(mockCancelPaymentIntent).not.toHaveBeenCalled();
      expect(mockReleasePendingOrder).not.toHaveBeenCalled();
    },
  );

  it('rejects cancellation by a different buyer', async () => {
    mockRetrievePaymentIntent.mockResolvedValue({
      status: 'requires_payment_method',
      metadata: { firebaseUid: 'other', orderId: 'order-1' },
    });
    await expect(
      new PaymentService().cancelPaymentIntentForUser('user-1', 'pi_123'),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_OWNER' });
    expect(mockCancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('releases only after Stripe confirms cancellation', async () => {
    const intent = {
      status: 'requires_payment_method',
      metadata: {
        firebaseUid: 'user-1',
        orderId: 'order-1',
        productId: 'product-1',
      },
    };
    mockRetrievePaymentIntent.mockResolvedValue(intent);
    mockCancelPaymentIntent.mockResolvedValue({
      ...intent,
      status: 'canceled',
    });
    await new PaymentService().cancelPaymentIntentForUser('user-1', 'pi_123');
    expect(mockCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    expect(mockReleasePendingOrder).toHaveBeenCalledWith('order-1', 'pi_123');
  });

  it('retains the lock when payment succeeds during cancellation', async () => {
    const metadata = {
      firebaseUid: 'user-1',
      orderId: 'order-1',
      productId: 'product-1',
    };
    mockRetrievePaymentIntent
      .mockResolvedValueOnce({ status: 'requires_payment_method', metadata })
      .mockResolvedValueOnce({ status: 'succeeded', metadata });
    mockCancelPaymentIntent.mockRejectedValue(new Error('Race'));
    await expect(
      new PaymentService().cancelPaymentIntentForUser('user-1', 'pi_123'),
    ).rejects.toMatchObject({ code: 'PAYMENT_STILL_ACTIONABLE' });
    expect(mockReleasePendingOrder).not.toHaveBeenCalled();
  });
});

describe('expired pending order reconciliation', () => {
  const pending = {
    id: 'order-expired',
    userId: 'buyer',
    productId: 'product-1',
    paymentIntentId: 'pi_expired',
    paymentExpiresAt: new Date(0),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPendingOrdersForProduct.mockResolvedValue([pending]);
    mockRetrievePaymentIntent.mockReset();
    mockCancelPaymentIntent.mockReset();
    mockGetOrderById.mockResolvedValue(pending);
    mockReleasePendingOrder.mockResolvedValue(undefined);
  });
  test('an expired actionable intent is cancelled before its reservation is released', async () => {
    const metadata = {
      firebaseUid: 'buyer',
      orderId: pending.id,
      productId: pending.productId,
    };
    mockRetrievePaymentIntent.mockResolvedValue({
      status: 'requires_payment_method',
      metadata,
    });
    mockCancelPaymentIntent.mockResolvedValue({ status: 'canceled', metadata });
    await new PaymentService().reconcileExpiredOrders(pending.productId);
    expect(mockReleasePendingOrder).toHaveBeenCalledWith(
      pending.id,
      pending.paymentIntentId,
    );
    expect(mockCancelPaymentIntent.mock.invocationCallOrder[0]).toBeLessThan(
      mockReleasePendingOrder.mock.invocationCallOrder[0],
    );
  });
  test('processing remains reserved after the deadline', async () => {
    mockRetrievePaymentIntent.mockResolvedValue({
      status: 'processing',
      metadata: { firebaseUid: 'buyer', orderId: pending.id },
    });
    await new PaymentService().reconcileExpiredOrders(pending.productId);
    expect(mockCancelPaymentIntent).not.toHaveBeenCalled();
    expect(mockReleasePendingOrder).not.toHaveBeenCalled();
  });
  test('an uncertain Stripe response never unlocks a listing', async () => {
    mockRetrievePaymentIntent.mockRejectedValue(new Error('Timeout'));
    await expect(
      new PaymentService().reconcileExpiredOrders(pending.productId),
    ).rejects.toThrow('Timeout');
    expect(mockReleasePendingOrder).not.toHaveBeenCalled();
  });
});
