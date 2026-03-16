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

// Mock Sendcloud config (so SendcloudService constructor doesn't throw)
jest.mock('../../../shared/config/sendcloudConfig', () => ({
  sendcloudConfig: {
    publicKey: 'test-pub',
    secretKey: 'test-sec',
    apiUrl: 'https://panel.sendcloud.sc/api/v2',
  },
}));

// Mock dependencies
jest.mock('../repositories/OrderRepository');
jest.mock('../../auth/repositories/UserRepository');
jest.mock('../../shipping/services/SendcloudService');
jest.mock('../../shipping/repositories/ShipmentRepository');

import { OrderRepository } from '../repositories/OrderRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { SendcloudService } from '../../shipping/services/SendcloudService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';

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

describe('createOrder controller – delivery method branching', () => {
  const mockSavedOrder = {
    id: 'order-123',
    userId: 'user-uid',
    amount: 5000,
    createdAt: new Date(),
  };
  const mockParcel = {
    id: 42,
    tracking_number: 'TN-001',
    tracking_url: 'https://track.me',
    carrier: { name: 'DHL' },
  };
  const mockShipment = { id: 'shipment-abc' };

  beforeEach(() => {
    jest.clearAllMocks();

    // UserRepository always resolves a valid user
    (UserRepository.prototype.getByFirebaseUid as jest.Mock).mockResolvedValue({
      email: 'test@example.com',
    });

    // OrderRepository always creates successfully
    (OrderRepository.prototype.createOrder as jest.Mock).mockResolvedValue(
      mockSavedOrder,
    );
    (
      OrderRepository.prototype.updateOrderTracking as jest.Mock
    ).mockResolvedValue(undefined);

    // SendcloudService.createParcel resolves with a parcel
    (SendcloudService.prototype.createParcel as jest.Mock).mockResolvedValue(
      mockParcel,
    );

    // ShipmentRepository.createShipment resolves with a shipment
    (
      ShipmentRepository.prototype.createShipment as jest.Mock
    ).mockResolvedValue(mockShipment);
  });

  it('calls SendcloudService.createParcel when deliveryMethod is "ship_to_home"', async () => {
    const req = makeMockReq({
      amount: 5000,
      deliveryMethod: 'ship_to_home',
      shipping: {
        name: 'Jane Doe',
        address: {
          line1: '1 High St',
          city: 'London',
          postal_code: 'SW1A1AA',
          country: 'GB',
        },
      },
    });
    const res = makeMockRes();

    await createOrder(req, res);

    expect(SendcloudService.prototype.createParcel).toHaveBeenCalledTimes(1);
    expect(ShipmentRepository.prototype.createShipment).toHaveBeenCalledTimes(
      1,
    );
    expect(OrderRepository.prototype.updateOrderTracking).toHaveBeenCalledWith(
      mockSavedOrder.id,
      mockParcel.tracking_number,
      mockShipment.id,
    );
  });

  it('does NOT call SendcloudService.createParcel when deliveryMethod is "pickup_point"', async () => {
    const req = makeMockReq({
      amount: 5000,
      deliveryMethod: 'pickup_point',
      courier: 'dhl',
      pickupPointId: '12345',
    });
    const res = makeMockRes();

    await createOrder(req, res);

    expect(SendcloudService.prototype.createParcel).not.toHaveBeenCalled();
    expect(ShipmentRepository.prototype.createShipment).not.toHaveBeenCalled();
  });

  it('does NOT call SendcloudService.createParcel when no deliveryMethod is provided', async () => {
    const req = makeMockReq({
      amount: 5000,
      shipping: {
        address: {
          line1: '1 High St',
          city: 'London',
          postal_code: 'SW1A1AA',
          country: 'GB',
        },
      },
    });
    const res = makeMockRes();

    await createOrder(req, res);

    expect(SendcloudService.prototype.createParcel).not.toHaveBeenCalled();
  });

  it('persists deliveryMethod and shippingProvider on the order', async () => {
    const req = makeMockReq({
      amount: 2500,
      deliveryMethod: 'pickup_point',
      courier: 'ups',
      pickupPointId: '999',
    });
    const res = makeMockRes();

    await createOrder(req, res);

    expect(OrderRepository.prototype.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryMethod: 'pickup_point',
        shippingProvider: 'sendcloud',
        courier: 'ups',
        pickupPointId: '999',
      }),
    );
  });

  it('still returns 200 when Sendcloud parcel creation fails (order is safe)', async () => {
    (SendcloudService.prototype.createParcel as jest.Mock).mockRejectedValue(
      new Error('Sendcloud is down'),
    );

    const req = makeMockReq({
      amount: 5000,
      deliveryMethod: 'ship_to_home',
      shipping: {
        address: {
          line1: '1 High St',
          city: 'London',
          postal_code: 'SW1A1AA',
          country: 'GB',
        },
      },
    });
    const res = makeMockRes();

    await createOrder(req, res);

    // Order should still be saved; the shipment failure is swallowed
    expect(OrderRepository.prototype.createOrder).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    const req = { user: null, body: { amount: 5000 } } as any;
    const res = makeMockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(OrderRepository.prototype.createOrder).not.toHaveBeenCalled();
  });
});
