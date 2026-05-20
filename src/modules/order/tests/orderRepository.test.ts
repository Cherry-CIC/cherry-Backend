const mockAdd = jest.fn();
const mockCollection = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: mockCollection,
  },
}));

import { OrderRepository } from '../repositories/OrderRepository';

describe('OrderRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'order-1' });
    mockCollection.mockReturnValue({
      add: mockAdd,
    });
  });

  it('persists pickup-point snapshot fields on the order', async () => {
    const repository = new OrderRepository();

    await repository.createOrder({
      userId: 'user-1',
      email: 'buyer@example.com',
      amount: 2599,
      deliveryType: 'pickup_point',
      shippingOptionId: '12345',
      shippingCarrier: 'inpost_gb',
      shippingWeight: 2500,
      shipping: {
        name: 'Jane Doe',
        telephone: '+447700900000',
        address: {
          line1: '10 Buyer Street',
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
      pickupPointId: '999',
      pickupPointName: 'Locker A',
      pickupPointAddressLine1: '1 Locker Street',
      pickupPointCity: 'London',
      pickupPointPostalCode: 'SW1A 2AA',
      pickupPointCountry: 'GB',
      pickupPointCarrier: 'inpost_gb',
      paymentIntentId: 'pi_123',
      paymentStatus: 'succeeded',
      shipmentStatus: 'pending',
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupPointId: '999',
        pickupPointName: 'Locker A',
        pickupPointAddressLine1: '1 Locker Street',
        pickupPointCity: 'London',
        pickupPointPostalCode: 'SW1A 2AA',
        pickupPointCountry: 'GB',
        pickupPointCarrier: 'inpost_gb',
        pickupPoint: expect.objectContaining({
          id: '999',
          addressLine1: '1 Locker Street',
        }),
      }),
    );
  });
});
