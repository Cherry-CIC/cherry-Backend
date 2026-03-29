# Contributing to cherry backend

Thanks for helping cherry. This backend is volunteer-friendly on purpose, so the first goal is clarity.

## Local setup

1. Install packages:

```bash
npm install
```

2. Copy the env template:

```bash
cp .env.example .env
```

3. For most local work, keep:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SENDCLOUD_MODE=mock
```

4. Start the API:

```bash
npm run start:dev
```

5. Open Swagger:

```text
http://localhost:3000/api-docs
```

## Mock-first workflow

Use the safest setup by default.

- Stripe should stay in sandbox for local development and MVP verification
- Sendcloud should stay in `mock` mode unless you are explicitly testing the live shipping path
- Do not test checkout with live money just to prove the flow works

## File ownership map

These paths usually matter together:

- App bootstrap: `src/app.ts`
- Auth middleware: `src/shared/middleware/authMiddleWare.ts`
- Stripe config and webhook verification: `src/shared/config/stripeConfig.ts`
- Payment routes and controller: `src/modules/payment/`
- Sendcloud config: `src/shared/config/sendcloudConfig.ts`
- Shipping providers and controllers: `src/modules/shipping/`
- Order creation and fulfilment branching: `src/modules/order/controllers/orderController.ts`
- Order persistence: `src/modules/order/repositories/OrderRepository.ts`

## Before opening a PR

Run:

```bash
npm run build
npm test -- --runInBand
```

If you change an API contract, also update:

- Swagger comments on the relevant route
- `.env.example` if the change adds or alters config
- README or docs when the local workflow changes

## Good first contributions

Good first backend tickets should always include:

- The exact file path or module area
- The expected request or response shape
- Any Swagger endpoint involved
- Whether the task should work in mock mode, live mode, or both

That removes guesswork for new contributors and keeps reviews quick.
