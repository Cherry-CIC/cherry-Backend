import { Request, Response } from 'express';
import { createOrder } from '../controllers/orderController';

// Mock Firebase config
jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({ verifyIdToken: jest.fn() }),
  },
  firestore: {
    collection: jest.fn(),
  },
}));

// Mock dependencies
jest.mock('../repositories/OrderRepository');
jest.mock('../../auth/repositories/UserRepository');
jest.mock('../../products/repositories/ProductRepository');
jest.mock('../../payment/services/PaymentService');
jest.mock('../../shipping/repositories/ShipmentRepository');
jest.mock('../../shipping/services/ShippingProviderFactory', () => ({
  createShippingProvider: jest.fn(),
}));

import { OrderRepository } from '../repositories/OrderRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { PaymentService } from '../../payment/services/PaymentService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { createShippingProvider } from '../../shipping/services/ShippingProviderFactory';

const makeMockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
};

const makeMockReq = (body: object, uid = 'user-uid'): Request =>
  ({
    user: { uid } as any,
    body,
  }) as any;

const makeHomeBody = (overrides: Record<string, any> = {}) => ({
  amount: 1299,
  paymentIntentId: 'pi_123',
  deliveryType: 'home',
  shippingOptionId: 'mvp-home-delivery',
  shippingWeight: 500,
  shipping: {
    name: 'Jane Doe',
    address: {
      line1: '1 High St',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
  },
  productId: 'product-123',
  productName: 'Frontend name is ignored',
  shippingOptionName: 'MVP home delivery',
  shippingOptionPrice: 299,
  shippingCarrier: 'evri',
  ...overrides,
});

const makePickupBody = (overrides: Record<string, any> = {}) => ({
  amount: 1000,
  paymentIntentId: 'pi_123',
  deliveryType: 'pickup_point',
  shippingOptionId: 'mvp-pickup-point-delivery',
  productId: 'product-123',
  productName: 'Frontend name is ignored',
  shippingOptionName: 'MVP pick-up point delivery',
  shippingOptionPrice: 0,
  shippingCarrier: 'inpost',
  pickupPoint: {
    id: 'pickup-123',
    name: 'Local Locker',
    addressLine1: '2 Station Road',
    city: 'London',
    postalCode: 'SW1A 1AA',
    country: 'GB',
    carrier: 'inpost',
  },
  ...overrides,
});

const setPaymentIntent = (
  amount: number,
  overrides: Record<string, any> = {},
) => {
  (PaymentService.prototype.getPaymentIntent as jest.Mock).mockResolvedValue({
    id: 'pi_123',
    amount,
    currency: 'gbp',
    status: 'succeeded',
    customer: 'cus_123',
    metadata: { firebaseUid: 'user-uid' },
    ...overrides,
  });
};

describe('createOrder controller checkout flow', () => {
  const mockShippingProvider = {
    createParcel: jest.fn(),
    createParcelToServicePoint: jest.fn(),
    getParcel: jest.fn(),
    getShippingMethods: jest.fn(),
    cancelParcel: jest.fn(),
    getLabelUrl: jest.fn(),
    getPickupPoints: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };
  const mockParcel = {
    id: 42,
    tracking_number: 'TN-001',
    tracking_url: 'https://track.me',
    carrier: { name: 'DHL' },
  };
  const mockShipment = { id: 'shipment-abc' };
  const mockProduct = {
    id: 'product-123',
    name: 'Server product name',
    description: 'A coat',
    categoryId: 'cat-1',
    charityId: 'charity-1',
    userId: 'seller-uid',
    quality: 'good',
    size: 'M',
    product_images: ['https://example.com/product.jpg'],
    donation: 10,
    price: 10,
    likes: 0,
    number: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createShippingProvider as jest.Mock).mockReturnValue(mockShippingProvider);

    (UserRepository.prototype.getByFirebaseUid as jest.Mock).mockResolvedValue({
      email: 'test@example.com',
    });
    (ProductRepository.prototype.getById as jest.Mock).mockResolvedValue(
      mockProduct,
    );
    (PaymentService.prototype.getCustomerEmail as jest.Mock).mockResolvedValue(
      'test@example.com',
    );
    setPaymentIntent(1299);

    (
      OrderRepository.prototype.getByPaymentIntentId as jest.Mock
    ).mockResolvedValue(null);
    (
      OrderRepository.prototype.createOrderIdempotently as jest.Mock
    ).mockImplementation(async (opts) => ({
      order: {
        id: 'order-123',
        ...opts,
        createdAt: new Date(),
      },
      created: true,
    }));
    (
      OrderRepository.prototype.updateOrderTracking as jest.Mock
    ).mockResolvedValue(undefined);
    (
      OrderRepository.prototype.updateOrderShipmentStatus as jest.Mock
    ).mockResolvedValue(undefined);

    mockShippingProvider.createParcel.mockResolvedValue(mockParcel);
    (
      ShipmentRepository.prototype.createShipment as jest.Mock
    ).mockResolvedValue(mockShipment);
    (
      ShipmentRepository.prototype.getShipmentByOrderId as jest.Mock
    ).mockResolvedValue(null);
  });

  it('creates a Sendcloud parcel for home delivery after payment succeeds', async () => {
    const req = makeMockReq(makeHomeBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(mockShippingProvider.createParcel).toHaveBeenCalledWith(
      expect.objectContaining({
        order_number: 'order-123',
        postal_code: 'SW1A 1AA',
        weight: 500,
      }),
    );
    expect(ShipmentRepository.prototype.createShipment).toHaveBeenCalledTimes(
      1,
    );
    expect(OrderRepository.prototype.updateOrderTracking).toHaveBeenCalledWith(
      'order-123',
      mockParcel.tracking_number,
      mockShipment.id,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-123',
          paymentIntentId: 'pi_123',
          shipmentStatus: 'announced',
          idempotent: false,
        }),
      }),
    );
  });

  it('persists server-owned product and shipping data', async () => {
    const req = makeMockReq(makeHomeBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1299,
        paymentIntentId: 'pi_123',
        productId: 'product-123',
        productName: 'Server product name',
        shippingOptionId: 'mvp-home-delivery',
        shippingOptionName: 'MVP home delivery',
        shippingOptionPrice: 299,
        shippingCarrier: 'evri',
        deliveryType: 'home',
        deliveryMethod: 'ship_to_home',
      }),
    );
  });

  it('keeps pickup-point shipment creation pending', async () => {
    setPaymentIntent(1000);
    const req = makeMockReq(makePickupBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(mockShippingProvider.createParcel).not.toHaveBeenCalled();
    expect(ShipmentRepository.prototype.createShipment).not.toHaveBeenCalled();
    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryType: 'pickup_point',
        deliveryMethod: 'pickup_point',
        pickupPointId: 'pickup-123',
        courier: 'inpost',
        shipmentStatus: 'pending',
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'pending',
        }),
      }),
    );
  });

  it('rejects totals that do not match product price plus server shipping', async () => {
    const req = makeMockReq(makeHomeBody({ amount: 999 }));
    const res = makeMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(PaymentService.prototype.getPaymentIntent).not.toHaveBeenCalled();
    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).not.toHaveBeenCalled();
  });

  it('rejects payments that have not succeeded', async () => {
    setPaymentIntent(1299, { status: 'requires_payment_method' });
    const req = makeMockReq(makeHomeBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).not.toHaveBeenCalled();
  });

  it('returns an idempotent order without creating another shipment', async () => {
    (
      OrderRepository.prototype.getByPaymentIntentId as jest.Mock
    ).mockResolvedValue({
      id: 'order-123',
      amount: 1299,
      paymentIntentId: 'pi_123',
      paymentStatus: 'succeeded',
      userId: 'user-uid',
      deliveryType: 'home',
      deliveryMethod: 'ship_to_home',
      shipmentStatus: 'pending',
      createdAt: new Date(),
    });
    (
      ShipmentRepository.prototype.getShipmentByOrderId as jest.Mock
    ).mockResolvedValue({
      id: 'shipment-existing',
      status: 'announced',
    });
    const req = makeMockReq(makeHomeBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(mockShippingProvider.createParcel).not.toHaveBeenCalled();
    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-123',
          shipmentStatus: 'announced',
          shipmentId: 'shipment-existing',
          idempotent: true,
        }),
      }),
    );
  });

  it('returns pending when shipment creation fails after the order is saved', async () => {
    mockShippingProvider.createParcel.mockRejectedValue(
      new Error('Sendcloud is down'),
    );
    const req = makeMockReq(makeHomeBody());
    const res = makeMockRes();

    await createOrder(req, res);

    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).toHaveBeenCalledTimes(1);
    expect(
      OrderRepository.prototype.updateOrderShipmentStatus,
    ).toHaveBeenCalledWith('order-123', 'pending');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'pending',
        }),
      }),
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    const req = { user: null, body: makeHomeBody() } as any;
    const res = makeMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(
      OrderRepository.prototype.createOrderIdempotently,
    ).not.toHaveBeenCalled();
  });
});
