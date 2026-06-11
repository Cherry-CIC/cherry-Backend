import Stripe from 'stripe';

// Ensure the Stripe API secret key is present at boot time.
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in the environment.');
}

// Ensure the webhook signing secret is present at boot time.
// This is the whsec_... value from the Stripe Dashboard → Webhooks → your endpoint.
// It is DIFFERENT from STRIPE_SECRET_KEY and must not be used interchangeably.
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET is not defined in the environment.');
}

// Ensure the publishable key is present at boot time.
// PaymentRepository returns this to the mobile client so the Stripe SDK can
// initialise. If missing, the client receives null and crashes with "Null is
// not a subtype of type 'String'". Fail fast at boot rather than at first
// /create-payment-intent call.
if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  throw new Error('STRIPE_PUBLISHABLE_KEY is not defined in the environment.');
}

// Initialise Stripe with the required API version.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const createWebhook = (rawBody: Buffer | string, sig: string): Stripe.Event => {
  // STRIPE_WEBHOOK_SECRET presence is guaranteed by the boot-time guard above.
  const event = stripe.webhooks.constructEvent(
    rawBody,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
  return event;
};

export {
  stripe,
  getCustomerByID,
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  createWebhook,
};
