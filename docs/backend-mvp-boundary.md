# cherry backend MVP boundary

This note defines what the backend should prove for cherry’s current MVP and what should stay out of scope for now.

## In scope

- The app can authenticate a user and create a checkout request safely
- The backend can create Stripe payment intents in test mode
- The backend can accept and verify Stripe webhooks
- The backend can create and store orders with a clear delivery method
- The backend can support shipping lookups and shipment flows through a stable backend contract
- Non-production environments can exercise shipping flows with mocked Sendcloud responses

## Out of scope for MVP verification

- Running live-money payment tests to prove the flow works
- Depending on a real courier handoff to validate the checkout journey
- Making physical delivery success a blocker for the digital checkout release
- Requiring first name or surname collection unless a later operational requirement clearly needs it

## Practical rules

- Use Stripe sandbox for local and MVP testing
- Default Sendcloud to `mock` mode outside production
- Keep webhook verification strict even in MVP
- Reject ambiguous order payloads instead of inferring intent from partial data
- Separate checkout stability work from later operational scaling work

## Why this matters

The MVP should answer one question first: does the digital donation checkout loop work reliably and clearly?

If live shipping operations, real-money tests, or extra profile collection are mixed into that question too early, the signal gets noisy and the software becomes harder to trust.
