
import Stripe from 'stripe';

// Ensure the secret key is present; throw a clear error if not.
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not defined in the environment.');
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
    description: 'New Customer'
  })

  return customer
}

const createEphemeralKey = async (customerId: string): Promise<Stripe.EphemeralKey> => {
  const ephemeralKey = await stripe.ephemeralKeys.create(
    {customer: customerId},
    {apiVersion: '2022-08-01'}
  );

  return ephemeralKey
}

const createPaymentIntent = async (
  amount: number,
  currency: string,
  customerId: string
): Promise<Stripe.PaymentIntent> => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: currency,
    customer: customerId,
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return paymentIntent
}

const createWebhook = (
  rawBody: Buffer | string,
  sig: string
): Stripe.Event => {
  const event = stripe.webhooks.constructEvent(
    rawBody,
    sig,
    process.env.STRIPE_SECRET_KEY!
  )
  return event
}

export {
  stripe,
  getCustomerByID,
  addNewCustomer,
  createEphemeralKey,
  createPaymentIntent,
  createWebhook
};
