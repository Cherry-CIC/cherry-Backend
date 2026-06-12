const mockCreatePaymentIntentForUser = jest.fn();
const mockGetUserById = jest.fn();
const mockGetProductById = jest.fn();
const mockGetPostageSizeById = jest.fn();
const mockGetDeliveryOptions = jest.fn();
const mockRetrievePaymentIntent = jest.fn();

jest.mock('../PaymentRepository', () => ({
  PaymentRepository: jest.fn().mockImplementation(() => ({
    createPaymentIntentForUser: mockCreatePaymentIntentForUser,
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
      paymentIntentId: 'pi_123',
      clientSecret: 'secret',
    });
  });

  it('calculates the total from trusted product and shipping data', async () => {
    const service = new PaymentService();

    const result = await service.createPaymentIntentForUserByUid(
      'user-1',
      {
        productId: 'product-1',
        shippingMethodId: '3747',
        pickupPointId: '13127548',
        country: 'GB',
        postalCode: 'SE18 4QH',
      },
    );

    expect(mockCreatePaymentIntentForUser).toHaveBeenCalledWith(
      'buyer@example.com',
      3149,
      expect.objectContaining({
        firebaseUid: 'user-1',
        productId: 'product-1',
        productAmount: '2500',
        shippingFee: '399',
        securityFee: '250',
        totalAmount: '3149',
      }),
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
