import Stripe from 'stripe';

// Ensure the secret key is present; throw a clear error if not.
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in the environment.');
}

if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  throw new Error('STRIPE_PUBLISHABLE_KEY is not defined in the environment.');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn(
    '⚠️  STRIPE_WEBHOOK_SECRET is not defined. Stripe webhook signature verification will fail until it is configured.',
  );
}

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-08-27.basil';

// Initialise Stripe with the required API version.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  typescript: true,
});

const getCustomerByID = async (id: string): Promise<Stripe.Customer> => {
  const customer = await stripe.customers.retrieve(id);

  if ((customer as Stripe.DeletedCustomer).deleted) {
    throw new Error(`Customer with ID ${id} has been deleted.`);
  }

  return customer as Stripe.Customer;
};

const addNewCustomer = async (email: string): Promise<Stripe.Customer> => {
  const customer = await stripe.customers.create({
    email,
    description: 'New Customer',
  });

  return customer;
};

const createEphemeralKey = async (
  customerId: string,
): Promise<Stripe.EphemeralKey> => {
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: STRIPE_API_VERSION },
  );

  return ephemeralKey;
};

const createPaymentIntent = async (
  amount: number,
  currency: string,
  customerId: string,
  metadata?: Stripe.MetadataParam,
): Promise<Stripe.PaymentIntent> => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: currency,
    customer: customerId,
    metadata,
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return paymentIntent;
};

const retrievePaymentIntent = async (
  paymentIntentId: string,
): Promise<Stripe.PaymentIntent> => {
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

const createWebhook = (rawBody: Buffer | string, sig: string): Stripe.Event => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not defined in the environment.');
  }

  const event = stripe.webhooks.constructEvent(
    rawBody,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  return event;
};

export {
  stripe,
  getCustomerByID,
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  retrievePaymentIntent,
  createWebhook,
};
