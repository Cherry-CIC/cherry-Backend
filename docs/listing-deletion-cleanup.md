# Listing deletion cleanup

This backend change extends `DELETE /api/products/{id}`. It does not add Flutter
controls, deploy rules, schedule a hosted job or sweep historical uploads.

## Behaviour and API contract

- Authentication remains required. Ownership, current orders and retention checks
  run in the same Firestore transaction as deletion.
- Pending payments remain protected, including expired or failed payments whose
  reservation is still active. Purchase history, refunds, partial sales, sold or
  uncertain stock and unknown historical orders prevent deletion. Only a confirmed
  unpaid cancellation is ignored; its order record is retained.
- Hidden/moderated listings, `retentionHold: true`, and unresolved product reports
  return `409 LISTING_REVIEW_REQUIRED`. Product report creation and reopening now
  coordinate with deletion. Closed reports are not erased.
- The transaction creates `listing_deletion_jobs/{productId}` and removes the
  product together. It never calls Storage inside a Firestore transaction.
- HTTP 200 retains the existing response envelope and means the listing is removed
  and cleanup is recorded. It does not mean all copies of the photos are erased.
- Repeating the request with the original owner's authentication returns 200 while
  the receipt exists. Another user receives 403. After the receipt expires, a
  missing listing returns `404 LISTING_NOT_FOUND`. A timeout may follow a committed
  deletion: the app should reconcile or repeat the request, not restore stale cards.
- `LISTING_PAYMENT_PENDING` and `LISTING_HAS_SALES` remain 409 responses.

## Durable cleanup

`ListingCleanupWorker` processes due jobs with a lease and bounded work. A crashed
worker's lease expires after ten minutes. It removes up to 1,000 matching
`user_likes` records per invocation, then continues later if necessary. New likes
cannot commit after product removal because their transaction reads the product.

Photos wait at least 30 days, preserving the existing media policy. This is a
project safety policy, not a statutory retention period. Likes need not wait.
Only the exact configured bucket, immutable `listing-media-v1/{owner}/{filename}`
path, verified owner/policy metadata and post-policy creation time qualify.
Legacy paths, external URLs, malformed references and uncertainty go to review.
An uncertain file is not silently forgotten or automatically erased.

Before erasing a candidate, the worker writes a retirement marker read by every
listing create/edit transaction. New
attachments then fail with `409 LISTING_MEDIA_RETIRED`. It scans surviving products
and orders for canonical object references, including URL aliases and nested
snapshots. Shared objects remain and are checked again after seven days. Scans
are capped at 2,000 documents per collection per candidate; an incomplete scan
requires review. This intentionally favours safety over automatic cleanup at
larger scale. Replace scanning with audited reference tracking before that scale.

Once safe, the worker records the inspected generation in a permanent retirement
marker before deleting with a generation-match precondition. Retries cannot delete
a replacement generation. Missing objects count as complete. Completed markers
contain only a hash key, state and generation, not URLs, participant details or
listing content. Retaining them prevents delayed writes reattaching retired
objects; assess their continued necessity in the retention review.

Jobs retain only owner/listing identifiers, token-free object paths and operational
state. They never copy descriptions, buyer information or download tokens. On
completion, photo paths are removed. The minimal owner receipt expires after 30
further days and is removed by a subsequent worker run. Review jobs do not expire
silently: maintainers must investigate them and record an appropriate outcome.

Transient failures back off from minutes up to one day. Eight failed attempts, a
generation mismatch or uncertain media require review. Provider error bodies are
not stored or logged. A restored listing or historical transaction discovered
later stops cleanup. Do not restore archived data or run unaudited writers while
cleanup is active: operational restores must replay deletions and retirement state.

## Local verification

Use Node 20+ and Java 21. The emulator runs Standard edition with the native
Firestore SDK; no hosted database or credentials are needed. The test rules deny
all client access and are not production rules.

```sh
npx -y firebase-tools@latest emulators:start \
  --project demo-cherry-integration --only auth,firestore,storage \
  --config firebase.cleanup-test.json
```

In a second terminal:

```sh
npm run build
STRIPE_SECRET_KEY=sk_test_cleanup_placeholder SENDCLOUD_MODE=mock EMAIL_MODE=off \
  npm test -- --runInBand

LISTING_INTEGRATION_TESTS=true \
FIREBASE_PROJECT_ID=demo-cherry-integration \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9299 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8280 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9399 \
  npm test -- --runInBand src/modules/products/tests/listingDeletionIntegration.test.ts \
  src/modules/products/tests/listingIntegration.test.ts
```

Integration fixtures use unique per-run IDs and remove only their own test data.
Worker concurrency uses real Firestore; deterministic Storage failures are injected.
A real Storage emulator test verifies metadata and replacement detection. The
emulator does not enforce the atomic generation-match delete condition; the adapter
also checks the current generation immediately before deletion. Unit tests verify
the request precondition, but its atomic provider behaviour still needs staging
verification before enabling hosted photo cleanup.

## Runner and release prerequisites

The worker is an explicit, bounded command, not an in-process timer. Dry run is
the default and counts due jobs only; it does not certify that photos are safe.

```sh
node dist/scripts/listingCleanup.js --project YOUR_CONFIRMED_PROJECT --limit 20
node dist/scripts/listingCleanup.js --project YOUR_CONFIRMED_PROJECT --limit 20 --apply
```

`--project` must match `FIREBASE_PROJECT_ID`. Emulator runs require all three
loopback hosts and a `demo-` project. Hosted runs require `NODE_ENV=production`
and the job's existing Application Default Credentials. No credentials belong
in command arguments. The command does not load a developer `.env` implicitly.

Before a separately authorised deployment:

1. Confirm the intended Git baseline, deployed payment flow and database edition.
   Reconcile any older actionable Stripe intents not represented by pending orders.
2. Deny client access to `listing_deletion_jobs` and `listing_media_retirements`,
   and direct product/order/report writes. Review broader wildcard rules too.
   Keep legitimate profile/address/upload access intact. Admin SDK writes bypass
   these rules, so audit scripts, old server instances and other privileged writers.
3. Verify owner-enforcing, create-only Storage rules and the immutable namespace
   cutoff. Audit legacy references and every photo attachment path.
4. Verify Storage soft deletion, object versions, backups and any legal holds.
   These can extend retention and charges after API deletion. Agree applicable
   retention and individual-erasure handling before promising total erasure.
5. Configure a scheduled job with the same build, an explicitly scoped project,
   required service-account permissions and bounded `--apply` command. A daily
   run is adequate initially; increase frequency/capacity if the queue grows.
   Do not rely on a web request or a volunteer's laptop remaining open.
6. Run disposable staging cases: shared/foreign photos, generation replacement,
   concurrent checkout/report/delete, interrupted worker, duplicate request and
   restoration of test backups. Verify no live payment, shipment or email is
   triggered by these tests.
7. Monitor scheduled-run failures, overdue `nextAttemptAt`, and jobs with
   `status=review`. Keep the Flutter delete action off until the API contract and
   cache handling are ready.

The command deliberately does not install a scheduler or change hosted settings.
Until scheduling and flags are configured, jobs remain durable and photos remain.

After fixing the cause of a review/waiting job, requeue a specific job:

```sh
node dist/scripts/listingCleanup.js --project YOUR_CONFIRMED_PROJECT \
  --retry VERIFIED_JOB_ID --apply --limit 20
```

This preserves the original grace period and rechecks eligibility; it does not
override ownership, references, media verification or generation protection.
For legacy photos, document verified ownership and references before any separate
manual erasure. Never clear retired markers simply to force an old upload through.

To pause physical cleanup, disable the scheduled job or storage flag. Retain
existing jobs and retirement markers. Do not roll back to writers which ignore
retirement markers while a worker can still delete objects. Restoring code does
not restore erased files.

## Local verification evidence

Verified on the implementation checkout, based on backend `2e59024`:

- TypeScript build passed.
- Configured unit suite: 461 passed; emulator-dependent cases skipped in that run.
- Combined listing/checkout and deletion emulator suites: 79 passed.
- DELETE OpenAPI authentication and conflict-response references checked.
- Compiled runner dry run against the demo project: zero jobs processed.
- Whitespace check passed.

Coverage includes 1,205 likes with bounded continuation, shared URL aliases and
nested order references, competing workers, expired leases, retry exhaustion,
account-deletion integration, report create/reopen races, concurrent photo reuse,
and actual emulator object replacement. Atomic Storage preconditions remain a
staging requirement because the emulator does not enforce them.

No hosted data, rules, settings or schedules were changed. Only disposable local
emulator fixtures were deleted. The Flutter application was not modified.
