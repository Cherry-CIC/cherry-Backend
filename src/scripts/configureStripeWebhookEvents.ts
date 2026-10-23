/**
 * Subscribe the Stripe webhook endpoint to the events the backend needs.
 *
 * Dry run by default: nothing changes without --apply. Existing subscriptions are
 * kept; only missing events are added. It acts on whichever Stripe account
 * STRIPE_SECRET_KEY belongs to, so check the key (test or live) first.
 *
 * Usage:
 *   npm run stripe:webhook:events -- --url https://your-service.example/api/payment/webhook
 *   npm run stripe:webhook:events -- --url <same> --apply
 */

import Stripe from 'stripe';
import { stripe } from '../shared/config/stripeConfig';
import { missingWebhookEvents } from '../modules/payment/services/payoutHoldEvents';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : undefined;

async function main(): Promise<void> {
  if (!url) {
    console.error('--url <webhook endpoint URL> is required');
    process.exit(1);
  }

  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live')
    ? 'LIVE'
    : 'test';
  console.log(`Stripe account mode: ${mode}`);

  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((candidate) => candidate.url === url);
  if (!endpoint) {
    console.error(`No webhook endpoint with URL ${url}. Found:`);
    endpoints.data.forEach((candidate) => console.error(`  ${candidate.url}`));
    process.exit(1);
  }

  const missing = missingWebhookEvents(endpoint.enabled_events);
  if (missing.length === 0) {
    console.log(`Endpoint ${endpoint.id} already receives every required event.`);
    return;
  }

  console.log(`Endpoint ${endpoint.id} is missing:`);
  missing.forEach((event) => console.log(`  ${event}`));

  if (!apply) {
    console.log('\nDry run: re-run with --apply to subscribe.');
    return;
  }

  await stripe.webhookEndpoints.update(endpoint.id, {
    enabled_events: [
      ...endpoint.enabled_events,
      ...missing,
    ] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
  });
  console.log('\nSubscribed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to update the webhook endpoint:', error);
    process.exit(1);
  });
