import { Request, Response } from 'express';
import { validateOrder } from '../validators/orderValidator';

const makeResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('validateOrder', () => {
  it('rejects shipping addresses without a delivery method', () => {
    const request = {
      body: {
        amount: 1000,
        shipping: {
          address: {
            line1: '1 High Street',
            city: 'London',
            postal_code: 'SW1A1AA',
            country: 'GB',
          },
        },
      },
    } as Request;
    const response = makeResponse();
    const next = jest.fn();

    validateOrder(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('requires courier and pickupPointId for pickup_point orders', () => {
    const request = {
      body: {
        amount: 1000,
        deliveryMethod: 'pickup_point',
      },
    } as Request;
    const response = makeResponse();
    const next = jest.fn();

    validateOrder(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts complete ship_to_home orders', () => {
    const request = {
      body: {
        amount: 1000,
        deliveryMethod: 'ship_to_home',
        shipping: {
          address: {
            line1: '1 High Street',
            city: 'London',
            postal_code: 'SW1A1AA',
            country: 'GB',
          },
        },
      },
    } as Request;
    const response = makeResponse();
    const next = jest.fn();

    validateOrder(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
