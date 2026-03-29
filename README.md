# cherry backend

The cherry backend is a Node.js and TypeScript API built with Express and Firebase. It powers the cherry mobile app and supports a simple, trustworthy donation checkout flow for pre-loved clothing.

## What this API covers

- Firebase-backed auth and user lookup
- Product, category, and charity APIs
- Order creation and CSV export
- Stripe payment intent creation and webhook handling
- Sendcloud shipping, pickup-point lookup, and webhook handling
- Swagger docs for local API exploration

## MVP boundary

For the current MVP, the backend is designed to validate the digital checkout loop safely.

- Use Stripe sandbox only for local development and testing
- Treat real money flows as out of scope for MVP verification
- Default non-production shipping to mocked responses so checkout can be exercised without live logistics
- Keep names optional in checkout payloads unless a later requirement makes them necessary

The fuller rationale is in `docs/backend-mvp-boundary.md`.

## Prerequisites

- Node.js 20 or later
- npm
- A Firebase project for non-test local development

## Quick start

1. Install dependencies:
```bash
npm install
```

2. Copy the env template:
```bash
cp .env.example .env
```

3. Choose one local Firebase path:
   - Emulator path: leave the service-account variables commented out and uncomment `FIREBASE_AUTH_EMULATOR_HOST` plus `FIRESTORE_EMULATOR_HOST`.
   - Real Firebase path: fill in the `FIREBASE_*` service-account values in `.env`.

4. Start the API:
```bash
npm run start:dev
```

The API runs on `http://localhost:3000` by default. Swagger is available at:
```text
http://localhost:3000/api-docs
```

## Auth profile sync

`GET /api/auth/sync` creates a Firestore user profile from the Firebase ID token when one does not already exist. This is intended for Apple and Google sign-in flows where the app already has an authenticated Firebase user.

The endpoint:
- returns `200` when the profile already exists
- returns `201` when a new profile is created
- returns `400` when the Firebase token does not include an email claim

## Emulator support

The backend will use the Firebase Auth and Firestore emulators automatically when `FIREBASE_AUTH_EMULATOR_HOST` or `FIRESTORE_EMULATOR_HOST` is set.

For emulator-based local work:
```env
FIREBASE_PROJECT_ID=cherry-mvp-dev
FIREBASE_API_KEY=dummy-api-key
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

## Environment notes

Important vars for local work:
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SENDCLOUD_MODE`
- `SENDCLOUD_PUBLIC_KEY`
- `SENDCLOUD_SECRET_KEY`
- `SENDCLOUD_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`

Recommended defaults:
- Keep Stripe in test mode locally
- Set `SENDCLOUD_MODE=mock` outside production
- Only use live Sendcloud credentials when you are deliberately testing the live shipping integration

See `.env.example` for the full template.

## Payments and shipping

Stripe payment amounts are expected in pence. For example, `1000` means `£10.00`.

The backend applies the cherry purchase security fee server-side using `PAYMENT_SECURITY_FEE_BPS`. The default is `1000`, which means a 10% fee. The payment-intent response includes the subtotal, fee, and total so the app can show the full breakdown clearly.

Stripe webhook verification requires `STRIPE_WEBHOOK_SECRET`. Sendcloud webhook verification uses `SENDCLOUD_WEBHOOK_SECRET` when provided, or falls back to `SENDCLOUD_SECRET_KEY` for API integrations.

## Development commands

```bash
npm run start:dev
npm run build
npm test -- --runInBand
npm run lint
npm run format
```

## Key backend ownership

These files are the main entry points for the checkout path:
- Auth: `src/shared/middleware/authMiddleWare.ts`, `src/modules/auth/`
- Orders: `src/modules/order/controllers/orderController.ts`, `src/modules/order/repositories/OrderRepository.ts`
- Payments: `src/shared/config/stripeConfig.ts`, `src/modules/payment/`
- Shipping: `src/shared/config/sendcloudConfig.ts`, `src/modules/shipping/`
- App wiring: `src/app.ts`

## Contributing

Start with `CONTRIBUTING.md`. It covers local setup, mock-first workflows, and the files that usually need to change together. Use short-lived feature branches. Keep changes focused. Update docs when behaviour changes. Run the build and relevant tests before opening a pull request.