const mockGetReservation = jest.fn();
const mockCancelIntent = jest.fn();
const mockReserve = jest.fn();
const mockActive = jest.fn().mockResolvedValue(null);
const mockApplyState = jest.fn();
const mockAttach = jest.fn();
jest.mock('../repositories/ListingReservationRepository', () => ({
  SAFE_STRIPE_RETRY_MS: 23 * 60 * 60 * 1000,
  ListingReservationRepository: jest
    .fn()
    .mockImplementation(() => ({
      reserve: mockReserve,
      activeForProduct: mockActive,
      applyStripeState: mockApplyState,
      attachIntent: mockAttach,
      get: mockGetReservation,
    })),
}));
const mockCreatePaymentIntentForUser = jest.fn();
const mockGetUserById = jest.fn();
const mockGetProductById = jest.fn();
const mockGetPostageSizeById = jest.fn();
const mockGetDeliveryOptions = jest.fn();
const mockRetrievePaymentIntent = jest.fn();

jest.mock('../PaymentRepository', () => ({
  PaymentRepository: jest.fn().mockImplementation(() => ({
    createPaymentIntentForUser: mockCreatePaymentIntentForUser,
    customerForEmail: jest.fn().mockResolvedValue('cus_123'),
    clientResponse: jest
      .fn()
      .mockResolvedValue({ paymentIntentId: 'pi_123', clientSecret: 'secret' }),
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
      cancel: mockCancelIntent,
    },
  },
}));

jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    enforcedCarrier: 'inpost_gb',
  },
}));

import { PaymentService } from '../services/PaymentService';

describe('PaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActive.mockResolvedValue(null);
    mockReserve.mockImplementation(async (input) => ({
      ...input,
      id: 'reservation-1',
      state: 'creating',
      createdAtMs: Date.now(),
      metadata: {
        ...input.metadata,
        listingReservationId: 'reservation-1',
        listingEditVersion: '0',
      },
    }));
    mockGetUserById.mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
    });
    mockGetProductById.mockResolvedValue({
      id: 'product-1',
      price: 25,
      number: 1,
      postageSize: 'postage-size-1',
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
      id: 'pi_123',
      status: 'requires_payment_method',
      client_secret: 'secret',
    });
  });

  it('calculates the total from trusted product and shipping data', async () => {
    const service = new PaymentService();

    const result = await service.createPaymentIntentForUserByUid('user-1', {
      productId: 'product-1',
      shippingMethodId: '3747',
      pickupPointId: '13127548',
      country: 'GB',
      postalCode: 'SE18 4QH',
    });

    expect(mockCreatePaymentIntentForUser).toHaveBeenCalledWith(
      'cus_123',
      3149,
      expect.objectContaining({
        firebaseUid: 'user-1',
        productId: 'product-1',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      }),
      'listing-reservation-reservation-1',
    );
    expect(result).toEqual(
      expect.objectContaining({
        productAmount: 2500,
        shippingFee: 399,
        securityFee: 250,
        totalAmount: 3149,
        currency: 'GBP',
      }),
    );
  });

  it('persists the intent binding before returning a client secret', async () => {
    await new PaymentService().createPaymentIntentForUserByUid('user-1', {
      productId: 'product-1',
      shippingMethodId: '3747',
      pickupPointId: '13127548',
      country: 'GB',
      postalCode: 'SE18 4QH',
    });
    expect(mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reservation-1' }),
      'pi_123',
    );
    expect(mockReserve.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreatePaymentIntentForUser.mock.invocationCallOrder[0],
    );
  });

  it('keeps an ambiguous creation failure reserved for reconciliation', async () => {
    mockCreatePaymentIntentForUser.mockRejectedValueOnce(
      new Error('Stripe timeout'),
    );
    await expect(
      new PaymentService().createPaymentIntentForUserByUid('user-1', {
        productId: 'product-1',
        shippingMethodId: '3747',
        pickupPointId: '13127548',
        country: 'GB',
        postalCode: 'SE18 4QH',
      }),
    ).rejects.toThrow('Stripe timeout');
    expect(mockReserve).toHaveBeenCalledTimes(1);
    expect(mockAttach).not.toHaveBeenCalled();
    expect(mockCancelIntent).not.toHaveBeenCalled();
    expect(mockApplyState).not.toHaveBeenCalled();
  });

  it('never recreates an uncertain expired intent outside the Stripe idempotency window', async () => {
    mockActive.mockResolvedValueOnce({
      id: 'old',
      userId: 'user-1',
      state: 'creating',
      createdAtMs: 0,
      expiresAtMs: 0,
    });
    await expect(
      new PaymentService().createPaymentIntentForUserByUid('user-1', {
        productId: 'product-1',
        shippingMethodId: '3747',
        pickupPointId: '13127548',
        country: 'GB',
        postalCode: 'SE18 4QH',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(mockCreatePaymentIntentForUser).not.toHaveBeenCalled();
    expect(mockApplyState).not.toHaveBeenCalled();
  });

  it('a cancellation racing a successful confirmation retains success protection', async () => {
    const intent = {
      id: 'pi_123',
      status: 'processing',
      metadata: {
        firebaseUid: 'user-1',
        listingReservationId: 'r1',
        productId: 'product-1',
      },
    };
    mockGetReservation.mockResolvedValue({
      id: 'r1',
      userId: 'user-1',
      paymentIntentId: 'pi_123',
    });
    mockRetrievePaymentIntent
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, status: 'succeeded' });
    mockCancelIntent.mockRejectedValueOnce(new Error('Already succeeded'));
    await expect(
      new PaymentService().cancelPaymentForUser('user-1', 'pi_123'),
    ).rejects.toMatchObject({ code: 'PAYMENT_STILL_ACTIONABLE' });
    expect(mockApplyState).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
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
});
