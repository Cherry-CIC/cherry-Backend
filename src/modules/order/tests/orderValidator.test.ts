import { validateOrder } from '../validators/orderValidator';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('orderValidator', () => {
  it('rejects pickup point delivery when pickupPoint is missing', () => {
    const req: any = {
      body: {
        amount: 2599,
        paymentIntentId: 'pi_123',
        shippingMethodId: '12345',
        shippingWeight: 2500,
        shippingCarrier: 'inpost_gb',
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
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateOrder(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid pickup point order payload', () => {
    const req: any = {
      body: {
        amount: 2599,
        paymentIntentId: 'pi_123',
        shippingMethodId: '12345',
        shippingWeight: 2500,
        shippingCarrier: 'inpost_gb',
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
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
