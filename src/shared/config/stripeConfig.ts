import Stripe from 'stripe';

// Validate configurations (just warnings at boot time to prevent container crashes)
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not defined in the environment.');
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn('STRIPE_WEBHOOK_SECRET is not defined in the environment.');
}
if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  console.warn('STRIPE_PUBLISHABLE_KEY is not defined in the environment.');
}

// Initialise Stripe lazily via Proxy to avoid throwing at boot time when the API key is missing
let stripeInstance: Stripe | null = null;
const stripe = new Proxy({} as Stripe, {
  get(target, prop, receiver) {
    if (!stripeInstance) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) {
        throw new Error('STRIPE_SECRET_KEY is not defined in the environment.');
      }
      stripeInstance = new Stripe(key);
    }
    return Reflect.get(stripeInstance, prop, receiver);
  },
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
    { apiVersion: '2022-08-01' },
  );

  return ephemeralKey;
};

const createPaymentIntent = async (
  amount: number,
  currency: string,
  customerId: string,
): Promise<Stripe.PaymentIntent> => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: currency,
    customer: customerId,
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return paymentIntent;
};

/**
 * Verifies and constructs a Stripe webhook event from the raw request body.
 *
 * Uses STRIPE_WEBHOOK_SECRET (whsec_...) — the signing secret specific to this
 * webhook endpoint — NOT the Stripe API secret key. Throws if the signature is
 * invalid or the payload is malformed; callers must catch and return HTTP 400.
 */
class WebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookConfigError';
    Object.setPrototypeOf(this, WebhookConfigError.prototype);
  }
}

const createWebhook = (rawBody: Buffer | string, sig: string): Stripe.Event => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new WebhookConfigError(
      'STRIPE_WEBHOOK_SECRET is not defined in the environment.',
    );
  }
  // Construct a temporary Stripe instance with a placeholder if the secret key is missing.
  // This bypasses the lazy Proxy which throws on access when STRIPE_SECRET_KEY is absent.
  // Webhook signature verification only performs local cryptographic validation.
  const verifier =
    stripeInstance || new Stripe(process.env.STRIPE_SECRET_KEY || 'dummy_key');
  const event = verifier.webhooks.constructEvent(rawBody, sig, secret);
  return event;
};

export {
  stripe,
  getCustomerByID,
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  createWebhook,
  WebhookConfigError,
};
