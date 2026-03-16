import Stripe from 'stripe';

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeConfigurationError';
  }
}

let stripeClient: Stripe | null = null;

const getRequiredStripeEnv = (
  key: 'STRIPE_SECRET_KEY' | 'STRIPE_PUBLISHABLE_KEY' | 'STRIPE_WEBHOOK_SECRET',
): string => {
  const value = process.env[key];
  if (!value) {
    throw new StripeConfigurationError(
      `${key} is not configured on the backend.`,
    );
  }

  return value;
};

export const getStripeClient = (): Stripe => {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredStripeEnv('STRIPE_SECRET_KEY'));
  }

  return stripeClient;
};

export const getStripePublishableKey = (): string =>
  getRequiredStripeEnv('STRIPE_PUBLISHABLE_KEY');

export const getStripeWebhookSecret = (): string =>
  getRequiredStripeEnv('STRIPE_WEBHOOK_SECRET');

const getCustomerByID = async (id: string): Promise<Stripe.Customer> => {
  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(id);

  if ((customer as Stripe.DeletedCustomer).deleted) {
    throw new Error(`Customer with ID ${id} has been deleted.`);
  }

  return customer as Stripe.Customer;
};

const addNewCustomer = async (email: string): Promise<Stripe.Customer> => {
  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    description: 'New Customer',
  });

  return customer;
};

const createEphemeralKey = async (
  customerId: string,
): Promise<Stripe.EphemeralKey> => {
  const stripe = getStripeClient();
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2022-08-01' },
  );

  return ephemeralKey;
};

const createPaymentIntent = async (
  amount: number,
  currency: string,
  customerId: string,
  metadata?: Record<string, string>,
): Promise<Stripe.PaymentIntent> => {
  const stripe = getStripeClient();
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    customer: customerId,
    automatic_payment_methods: {
      enabled: true,
    },
    metadata,
  });

  return paymentIntent;
};

const createWebhook = (
  rawBody: Buffer | string,
  sig: string,
): Stripe.Event => {
  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    sig,
    getStripeWebhookSecret(),
  );
  return event;
};

export {
  getCustomerByID,
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  createWebhook,
};
