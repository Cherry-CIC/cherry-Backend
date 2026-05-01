import { Request, Response } from 'express';
import { validateOrder } from '../validators/orderValidator';

const makeResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

const validHomeBody = {
  amount: 1299,
  paymentIntentId: 'pi_123',
  deliveryType: 'home',
  shippingOptionId: 'mvp-home-delivery',
  shippingWeight: 500,
  shipping: {
    name: 'Jane Doe',
    address: {
      line1: '1 High Street',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
  },
  productId: 'product-123',
  productName: 'Frontend name',
  shippingOptionName: 'MVP home delivery',
  shippingOptionPrice: 299,
  shippingCarrier: 'evri',
};

const validPickupBody = {
  amount: 1000,
  paymentIntentId: 'pi_123',
  deliveryType: 'pickup_point',
  shippingOptionId: 'mvp-pickup-point-delivery',
  productId: 'product-123',
  productName: 'Frontend name',
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
};

const runValidation = (body: object) => {
  const request = { body } as Request;
  const response = makeResponse();
  const next = jest.fn();

  validateOrder(request, response, next);

  return { response, next };
};

describe('validateOrder', () => {
  it('accepts complete home delivery orders', () => {
    const { response, next } = runValidation(validHomeBody);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('accepts complete pickup-point orders', () => {
    const { response, next } = runValidation(validPickupBody);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('rejects missing paymentIntentId', () => {
    const { paymentIntentId, ...body } = validHomeBody;
    const { response, next } = runValidation(body);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects home delivery without a shipping address', () => {
    const { response, next } = runValidation({
      ...validHomeBody,
      shipping: undefined,
    });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects pickup-point delivery without pickupPoint details', () => {
    const { pickupPoint, ...body } = validPickupBody;
    const { response, next } = runValidation(body);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects shipping options that do not match the delivery type', () => {
    const { response, next } = runValidation({
      ...validHomeBody,
      shippingOptionId: 'mvp-pickup-point-delivery',
    });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
