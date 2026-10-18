# Listing editing and pending checkout

Editing is off by default. This change extends the pending-order checkout on backend `main`; it does not restore the separate reservation collection from the earlier listing-edit branch.

## API contract

`PUT /api/products/{id}` requires authentication, `LISTING_EDIT_ENABLED=true`, `expectedEditVersion` and at least one changed field. Only `name`, `description`, `categoryId`, `quality`, `size` and ordered `product_images` are accepted. Unknown fields are rejected. Ownership, version, category, stock, lifecycle, purchase history and pending payments are checked in the same transaction as the update. Omitted fields remain unchanged.

Missing stored versions are read as zero without a bulk write. Malformed versions are not editable. Successful edits increment the version. Availability changes, completed purchases, moderation and retained-account anonymisation advance it too. Likes do not. Product and public profile responses expose the version without internal sale flags.

Errors retain the existing response envelope and add a machine-readable `code`. Stale requests return `409 LISTING_VERSION_CONFLICT`; missing buyer versions on edited listings return `409 LISTING_VERSION_REQUIRED`. Ownership returns 403, invalid inputs/media return 400, unavailable media configuration and disabled editing return 503. Pending payments and purchase history return 409. Swagger documents the request fields and conflict responses.

## Checkout coordination

`POST /api/payment/create-payment-intent` receives the reviewed version and the complete shipping/pickup selection. The server derives amounts and participant identities, then atomically creates a pending order against the reviewed listing version. The order freezes the selection, amount, revision and Stripe customer. Identical owned retries reuse that order and its PaymentIntent. Stripe creation uses the order ID as an idempotency key. Ambiguous creation or attachment failures retain the reservation.

The response includes `orderId`, `paymentIntentId` and `paymentStatus`. The frontend must retain both IDs and send only those IDs to `POST /api/order/create`. A 202 response means payment is confirmed while shipment work is pending. The frontend preserves paid checkout state on failure and retries finalisation without a second payment. Cancellation is authenticated through `POST /api/payment/cancel-payment-intent` with `paymentIntentId`.

A deadline never unlocks an actionable Stripe payment. On a subsequent checkout request, expired pending orders are reconciled: confirmed cancellation releases the lock; successful payments are finalised; processing and uncertain outcomes remain locked. Delayed successful callbacks can finalise a still-reserved order after its deadline. Duplicate finalisation does not decrement stock again. Account deletion cannot remove either participant during a pending checkout.

An uncertain creation can be replayed with frozen arguments for at most 23 hours. Beyond that, or for older pending orders without recovery metadata, operator reconciliation is required. Never clear `reservationActive`, delete a pending order or reset stock merely because its deadline passed. Retrieve the actual Stripe payment, confirm cancellation or finalise the successful payment, then use the repository flow. This conservative limit accounts for [Stripe's 24-hour idempotency retention](https://docs.stripe.com/api/idempotent_requests). A payment is safe to unlock only after [confirmed cancellation](https://docs.stripe.com/api/payment_intents/cancel).

Any purchase, including a partial sale or refund, prevents later descriptive editing. Unknown legacy order history is treated conservatively. Only a confirmed unpaid cancellation is ignored.

## Photos and Firebase prerequisites

Photos must use immutable `listing-media-v1/{uid}/{filename}` objects in `LISTING_MEDIA_BUCKET`. Supported formats are JPEG, PNG and non-animated WebP: 1–10 photos, at most 10 MiB and 40 million pixels each. The backend validates the exact origin, bucket, path, owner/policy metadata, creation cutoff, generation, token, byte size and decoded image. Every retained photo is revalidated on a descriptive edit. Unique uploads remain in storage when removed from a listing.

Set `LISTING_MEDIA_RULES_VERIFIED=true` and `LISTING_MEDIA_POLICY_START` only after verifying the actual deployed rules. Client-supplied ownership metadata is trustworthy only under owner-enforcing, create-only rules. Ordinary clients must not overwrite/delete these objects or directly write products, versions, reservations, orders, fulfillment jobs, payment-intent locks or account-deletion markers. Check broad wildcard rules too: a restrictive rule does not override a separate permissive match.

Legacy photos outside this namespace are not assumed safe. Sellers must replace them, or an authorised migration must verify ownership and copy them into immutable storage. Never silently bless legacy media. There is no automatic deletion in this change. Any later orphan cleanup must wait a conservative grace period (at least 30 days), recheck listing and order references immediately before deletion, and preserve uncertain or historical references.

No shared Firebase rules, indexes or hosted service settings were changed for this work. Local rule fixtures demonstrate the test journey; they are not a complete production rules rollout. The repositories use product-ID order queries and account-ID queries, without a new composite index.

## Release checklist

1. Audit deployed Firestore and Storage rules against the actual app's profile, address, locker, username and upload flows. Review compatible rules separately before deployment.
2. Reconcile all previously issued actionable Stripe intents, including those issued before pending orders existed, expired orders released by older code, and records in any older reservation collection. Cancel and confirm unpaid intents or finalise paid ones. Do not enable editing while an untracked payment can still succeed. Preserve known sale history and reconcile uncertain legacy listings conservatively.
3. Verify the immutable namespace and cutoff. Test existing listings with both retained verified media and replacement legacy photos. No automatic bulk version migration is needed.
4. Deploy the backend with editing off, then deploy the compatible frontend from PR #525 with its flag off. The frontend now requires the pending-order response contract.
5. In a separately approved staging release, enable backend editing and the frontend `ENABLE_LISTING_EDIT` flag. Test owner/non-owner access, stale saves, photos, simultaneous buyer/seller actions, cancellation, declined/processing payments, paid-order retry and duplicate callbacks. Local Stripe tests use real test-mode payments with mocked shipping and email/labels off; they do not prove live shipping or hosted webhook delivery.
6. Enable the shared release only after these checks and deployment approval. Roll back by disabling both edit flags while retaining payment reconciliation and version fields. Do not deploy an older backend that unlocks pending payments by time or remove historical media.

## Verification

Unit checks: `npm run build` and `npm test -- --runInBand`.

Run transaction tests against local Auth, Firestore and Storage emulators:

```sh
LISTING_INTEGRATION_TESTS=true \
FIREBASE_PROJECT_ID=demo-cherry-integration \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
npm test -- --runInBand src/modules/products/tests/listingIntegration.test.ts
```

These tests use a dedicated demo project and remove only their own generated documents. Normal unit runs skip the 24 emulator-dependent cases; seven input checks still run. Local backend credentials are enabled only when all three services use loopback addresses; partial configurations and production emulator settings are rejected. Use `HOST=127.0.0.1` for a local server.
