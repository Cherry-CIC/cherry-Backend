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
        deliveryMethod: 'pickup_point',
        paymentIntentId: 'pi_123',
        shippingMethodId: '12345',
        shippingWeight: 2500,
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
        deliveryMethod: 'pickup_point',
        paymentIntentId: 'pi_123',
        shippingMethodId: '12345',
        shippingWeight: 2500,
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
        },
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body.pickupPoint.carrier).toBeUndefined();
  });

  it('accepts a home delivery order without a pickup point', () => {
    const req: any = {
      body: {
        amount: 2599,
        deliveryMethod: 'home',
        paymentIntentId: 'pi_123',
        shippingMethodId: '12345',
        shippingWeight: 2500,
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
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('normalises snake_case delivery fields and applies the default parcel weight', () => {
    const req: any = {
      body: {
        amount: 2599,
        delivery_method: 'pickup_point',
        payment_intent_id: 'pi_123',
        shipping_method_id: '12345',
        shipping: {
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
        },
      },
    };
    const res = createResponse();
    const next = jest.fn();

    validateOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.deliveryMethod).toBe('pickup_point');
    expect(req.body.shippingMethodId).toBe('12345');
    expect(req.body.shippingWeight).toBe(1000);
  });
});
