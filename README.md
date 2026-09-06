# cherry backend

The cherry backend is a Node.js and TypeScript API built with Express and Firebase. It powers the cherry mobile app and supports a simple, trustworthy donation checkout flow for pre-loved clothing.

## What this API covers

- Firebase-backed auth and user lookup
- Product, category, and charity APIs
- Order creation and CSV export
- Stripe payment intent creation and webhook handling
- Sendcloud shipping, pickup-point lookup, and webhook handling
- User product management, liked items, and order tracking APIs
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

3. Fill in the values you need for your local setup.

4. Start the API:

```bash
npm run start:dev
```

The API runs on `http://localhost:3000` by default.

Swagger is available at:

```text
http://localhost:3000/api-docs
```

## Environment notes

Important vars for local work:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SENDCLOUD_MODE`
- `SENDCLOUD_PUBLIC_KEY`
- `SENDCLOUD_SECRET_KEY`
- `SENDCLOUD_LABEL_MODE`
- `EMAIL_MODE`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `FIREBASE_PROJECT_ID`

Recommended defaults:

- Keep Stripe in test mode locally
- Set `SENDCLOUD_MODE=mock` outside production
- Use `SENDCLOUD_LABEL_MODE=test` in development and `SENDCLOUD_LABEL_MODE=live` in production when real labels should be generated
- Keep `EMAIL_MODE=off` unless you are intentionally sending email through Resend
- Only use live Sendcloud credentials when you are deliberately testing the live shipping integration

See `.env.example` for the full template.

## Development commands

```bash
npm run start:dev
npm run build
npm test -- --runInBand
```

## Key backend ownership

These files are the main entry points for the checkout path:

- Auth: `src/shared/middleware/authMiddleWare.ts`, `src/modules/auth/`
- Orders: `src/modules/order/controllers/orderController.ts`, `src/modules/order/repositories/OrderRepository.ts`
- Payments: `src/shared/config/stripeConfig.ts`, `src/modules/payment/`
- Shipping: `src/shared/config/sendcloudConfig.ts`, `src/modules/shipping/`
- App wiring: `src/app.ts`

## User-Facing Account APIs

The backend now exposes authenticated user-facing listing, likes, and order-tracking routes:

- `DELETE /api/auth/account`
  Deletes the authenticated account, removes profile and likes, deletes unsold listings, and anonymises retained commerce history.
- `GET /api/products/my-products`
  Returns the current user's listings with cursor pagination, search, and filters.
- `GET /api/products/my-liked-items`
  Returns the current user's liked products with cursor pagination, search, and filters.
- `POST /api/products/:id/like`
  Likes or unlikes a product for the current user and updates the product like count.
- `GET /api/order/my-orders`
  Returns the current user's orders enriched with shipment, tracking, and derived delivery-state fields.
- `GET /api/order/:id`
  Returns a single owned order with the same shipment and delivery-state fields.

Important order-tracking fields returned by the order APIs:

- `paymentState`
- `deliveryState`
- `deliveryLabel`
- `canTrack`
- `trackingNumber`
- `trackingUrl`
- `carrier`
- `shipment`

Account deletion and retention behaviour is documented in `docs/account-deletion-policy.md`.

## Contributing

Start with `CONTRIBUTING.md`. It covers local setup, mock-first workflows, and the files that usually need to change together.
