const mockGetUserById = jest.fn();
const mockCustomersList = jest.fn();
const mockCustomersCreate = jest.fn();
const mockEphemeralKeysCreate = jest.fn();
const mockPaymentIntentsCreate = jest.fn();

const mockStripeClient = {
  customers: {
    list: mockCustomersList,
    create: mockCustomersCreate,
  },
  ephemeralKeys: {
    create: mockEphemeralKeysCreate,
  },
  paymentIntents: {
    create: mockPaymentIntentsCreate,
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripeClient));

jest.mock('../../../shared/middleware/authMiddleWare', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { uid: 'firebase-user-1' };
    next();
  },
}));

jest.mock('../../auth/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getById: mockGetUserById,
  })),
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_secret';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';

import express from 'express';
import request from 'supertest';

const paymentRoutes = require('../routes/paymentRoutes').default;

const app = express();
app.use(express.json());
app.use('/api/payment', paymentRoutes);

describe('paymentRoutes.createPaymentIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';

    mockGetUserById.mockResolvedValue({
      id: 'firebase-user-1',
      email: 'buyer@example.com',
    });
    mockCustomersList.mockResolvedValue({
      data: [{ id: 'cus_existing' }],
    });
    mockCustomersCreate.mockResolvedValue({
      id: 'cus_new',
    });
    mockEphemeralKeysCreate.mockResolvedValue({
      secret: 'ek_test_123',
    });
    mockPaymentIntentsCreate.mockImplementation(async (payload) => ({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret_456',
      amount: payload.amount,
      currency: payload.currency,
    }));
  });

  it.each([100, 338, 448, 1099])(
    'sends %i pence directly to Stripe',
    async (amount) => {
      const response = await request(app)
        .post('/api/payment/create-payment-intent')
        .send({ amount });

      expect(response.status).toBe(200);
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
        amount,
        currency: 'gbp',
        customer: 'cus_existing',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      expect(typeof mockPaymentIntentsCreate.mock.calls[0][0].amount).toBe(
        'number',
      );
    },
  );

  it('does not inflate 448 pence by multiplying it or adding a fee before multiplying', async () => {
    await request(app)
      .post('/api/payment/create-payment-intent')
      .send({ amount: 448 });

    const stripeAmount = mockPaymentIntentsCreate.mock.calls[0][0].amount;

    expect(stripeAmount).toBe(448);
    expect(stripeAmount).not.toBe(44800);
    expect(stripeAmount).not.toBe(46800);
  });

  it('normalises an integer pence string to a number before calling Stripe', async () => {
    await request(app)
      .post('/api/payment/create-payment-intent')
      .send({ amount: '448' });

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 448,
        currency: 'gbp',
      }),
    );
    expect(typeof mockPaymentIntentsCreate.mock.calls[0][0].amount).toBe(
      'number',
    );
  });

  it.each([
    ['missing amount', {}],
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -1 }],
    ['decimal amount', { amount: 448.5 }],
    ['non-numeric string amount', { amount: 'not-a-number' }],
  ])('rejects %s', async (_caseName, body) => {
    const response = await request(app)
      .post('/api/payment/create-payment-intent')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        message: 'Invalid amount',
        error: 'Amount must be a positive integer in the smallest currency unit',
      }),
    );
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockCustomersList).not.toHaveBeenCalled();
    expect(mockEphemeralKeysCreate).not.toHaveBeenCalled();
  });

  it('returns the client secret and PaymentIntent metadata expected by Flutter', async () => {
    const response = await request(app)
      .post('/api/payment/create-payment-intent')
      .send({ amount: 448 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        clientSecret: 'pi_test_123_secret_456',
        paymentIntent: 'pi_test_123_secret_456',
        paymentIntentId: 'pi_test_123',
        amount: 448,
        currency: 'gbp',
      }),
    );
  });
});
