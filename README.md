# cherry backend

Node.js and TypeScript API for the cherry mobile app. cherry helps turn pre-loved clothing into 100% donations for UK-registered charities.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
3. Choose one local Firebase path:
   - Emulator path: leave the service-account variables commented out and uncomment `FIREBASE_AUTH_EMULATOR_HOST` plus `FIRESTORE_EMULATOR_HOST`.
   - Real Firebase path: fill in the `FIREBASE_*` service-account values in `.env`.
4. Start the backend:
   ```bash
   npm run start:dev
   ```

The API runs on `http://localhost:3000` by default. Swagger docs are available at `http://localhost:3000/api-docs`.

## Payments and shipping

Stripe payment amounts are expected in pence. For example, `1000` means `£10.00`.

The backend applies the cherry purchase security fee server-side using `PAYMENT_SECURITY_FEE_BPS`. The default is `1000`, which means a 10% fee. The payment-intent response includes the subtotal, fee, and total so the app can show the full breakdown clearly.

Stripe webhook verification requires `STRIPE_WEBHOOK_SECRET`. Sendcloud webhook verification uses `SENDCLOUD_WEBHOOK_SECRET` when provided, or falls back to `SENDCLOUD_SECRET_KEY` for API integrations.

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

## Useful commands

```bash
npm run build
npm test
npm run lint
npm run format
```

## Contributing

Use short-lived feature branches. Keep changes focused. Update docs when behaviour changes. Run the build and relevant tests before opening a pull request.
