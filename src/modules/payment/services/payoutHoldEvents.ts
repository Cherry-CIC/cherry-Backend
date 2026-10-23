// Stripe events that put an order's funds on hold, or lift a hold.
export const PAYOUT_HOLD_EVENT_TYPES = [
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'radar.early_fraud_warning.created',
] as const;

export const isPayoutHoldEvent = (eventType: string): boolean =>
  (PAYOUT_HOLD_EVENT_TYPES as readonly string[]).includes(eventType);

// Everything the webhook endpoint must be subscribed to.
export const REQUIRED_WEBHOOK_EVENTS: readonly string[] = [
  'payment_intent.succeeded',
  'payment_intent.canceled',
  ...PAYOUT_HOLD_EVENT_TYPES,
];

// Events to add to an endpoint's subscription; none when it takes every event.
export const missingWebhookEvents = (enabledEvents: readonly string[]): string[] =>
  enabledEvents.includes('*')
    ? []
    : REQUIRED_WEBHOOK_EVENTS.filter((event) => !enabledEvents.includes(event));
