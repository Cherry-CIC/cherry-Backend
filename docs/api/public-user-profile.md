# Public seller profiles

`GET /api/users/{userId}/public-profile?limit=20&cursor=...` requires the existing
Firebase bearer ID-token middleware. The path is a Firebase Authentication UID,
not a generated Firestore document ID. No private account fields are returned.

This change is independent of UGC policy and Community Rules work. It does not
change registration, account settings, product creation or `my-products`.

## Contract

A successful response contains exactly `success`, `data` and `meta`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "seller-firebase-uid",
      "username": "Alex",
      "profileImageUrl": null
    },
    "products": []
  },
  "meta": { "limit": 20, "nextCursor": null, "hasMore": false }
}
```

The user appears on every page, including empty pages. Limit is an integer from
1 to 50, default 20. The successful response has `Cache-Control: private, no-store`.
Unknown query fields are stripped by the established validation middleware;
clients cannot override owner, status or visibility. Invalid UIDs and cursors
return 400. Firebase UID validation rejects controls before trimming, separators,
`.` and `..`, `deleted_user`, empty values and identifiers over 128 characters.

Missing or invalid authentication returns 401. Unavailable profiles all return
404 with `This profile is unavailable` and no user or listing data. Database,
Authentication lookup, missing encryption configuration and scan-budget failures
return a generic retryable 503. Raw errors are neither returned nor logged by
this endpoint. The shared authentication middleware also uses a fixed error
summary instead of exposing Firebase exceptions. There is no application-level
blocking or rate-limit system at the inspected revision. Existing deployment
access/rate controls, if configured, may return 403 or 429; this change does not
claim to introduce either system or change IAM permissions.

## Public identity and duplicate records

`PublicUserRepository.getByFirebaseUid` is the single profile-resolution boundary:

1. Firebase Admin Authentication must report an existing, enabled account.
   Authentication records never leave the repository. Only missing/disabled
   account errors become unavailable; operational failures propagate.
2. Read selected fields from `users/{uid}` and query `users` where stored `id`
   equals the UID. The canonical record is excluded from the legacy candidates.
3. Reject contradictory stored `id` or `firebaseUid` fields. Never use an internal
   generated document ID as an account identity.
4. Prefer a non-empty, trimmed canonical `username`, then an unambiguous linked
   legacy `username`. Otherwise use the neutral display label `User`.
5. Avatar precedence is canonical `profileImageUrl`, `photoURL`, `photoUrl`, then
   the same aliases on linked legacy records. Invalid aliases fall through.
   Only HTTP(S) URLs with a host and no embedded credentials are accepted;
   otherwise return null.
6. Distinct non-empty legacy usernames or distinct valid legacy avatars make the
   profile unavailable, even when a canonical value exists. Consistent duplicate
   values and missing values can be combined. More than 20 linked records also
   makes the profile unavailable, rather than selecting an arbitrary subset.
   This bounds reads and deliberately requires review of damaged records.

Only `id`, `username`, `profileImageUrl` can appear in the user DTO. Email, private
names, addresses, provider identities, settings and nested records are excluded.

### Why private names are not fallbacks

The Flutter registration form collects Username and First Name separately.
Social sign-in can copy a provider's full display name into `firstname`. Previous
seller displays used `users/{uid}.username`, then `User`; no inspected code
establishes `displayName` or `firstname` as explicitly public. Therefore this
endpoint deliberately does not expose either field, even for legacy accounts.
Their existence was inspected, not treated as consent to publish them. A seller
without a chosen public username remains available under `User`.

## Listings and pagination

`PublicProductRepository` queries products by forced owner and `status == active`,
ordered by `createdAt` descending and document ID descending. Every record is
checked again before mapping. Positive integer stock is required. A missing or
unknown status is excluded, rather than inferred as active.

Existing listings have no persisted visibility/moderation schema. The explicit
legacy rule is that absent publication fields retain active-and-positive-stock
eligibility. Defensive handling of fields already present in a document is:

- `visibility` must be `public` when present.
- `moderationStatus` must be `approved` when present.
- `publicationStatus` must be `published` when present.
- Unknown `moderation` or `publication` objects are excluded pending a reviewed
  schema, rather than interpreted as approval.
- `deleted`, `isDeleted`, `removed`, `isRemoved`, `hidden`, `isHidden` and
  `moderationHidden` must be absent or false.
- `deletedAt`, `removedAt` and `hiddenAt` must be absent or null.

These fields are read defensively, not introduced or persisted by this change.
Future moderation changes must update the predicate and cursor policy version
before deployment. Missing fields do not hide all valid legacy listings.

Only eligible products receive the literal `visibility: public`. The product DTO
contains the fields required by Flutter listing details and checkout, calculated
`securityFee`, and optional category/charity IDs. It includes no nested category,
charity, order or shipment records. Stored `donation` and `price` are preserved;
security fees use the existing GBP-to-pence and checkout calculation helpers.
Missing description becomes an empty string and missing likes becomes zero,
matching creation defaults. Missing or invalid money is never fabricated.
Malformed required product fields or non-Timestamp `createdAt` are excluded;
invalid image URLs are removed. Listing records missing `createdAt` do not enter
the ordered Firestore query. These damaged records need separate data review.

The repository scans chunks of 100 until it finds `limit + 1` eligible records or
the source is exhausted. Excluded records cannot cause intermediate empty pages
or determine `hasMore`. The next position uses the last returned public record,
never an excluded record. A 5,000-record scan budget returns 503 on exhaustion
instead of a misleading partial page. It bounds per-request reads; a persistently
exhausted seller requires data review rather than repeated retries alone.

Cursors use AES-256-GCM authenticated encryption. Seller UID, viewer UID and the
versioned public policy are authenticated scope. Timestamp seconds and nanoseconds
are preserved; document ID breaks ties. Cursors expire after 24 hours and are
invalidated by key rotation or policy changes. They contain no private records
and cannot be modified or reused for a different seller or viewer. As with normal
Firestore pagination, changing inventory between requests is not a frozen
snapshot: sold/hidden listings are excluded on the next request, and new listings
before the current position appear after refresh.

## Local verification

Use fictional accounts and the local standard-edition emulator. No real user
records are queried or modified by tests. The smoke script refuses to run unless
the project is `demo-cherry-profiles` and both emulator hosts are numeric IPv4
loopback addresses. It sets inert service configuration and cleans up only its
uniquely prefixed fixture accounts and documents.

```bash
npm install
npm run build
npm test -- --runInBand
FIREBASE_PROJECT_ID=demo-cherry-profiles npx -y firebase-tools@latest emulators:exec \
  --project demo-cherry-profiles --config firebase.emulators.json \
  --only auth,firestore 'node scripts/test-public-profiles-emulator.js'
```

The current Firebase CLI requires Java 21 or later. Point `JAVA_HOME` and `PATH`
to an existing supported installation when necessary. Emulator rules deny client
access; Admin SDK tests exercise the mandatory server filtering. These local
rules are not referenced by the deployment configuration.

The smoke script exercises the actual app, bearer verification, Firestore query,
precise pagination, scan-through behaviour, unavailable accounts, network-body
privacy checks and served Swagger. The emulator does not enforce composite index
requirements, so staging still must verify the deployed index is ready.
See [Firebase emulator limitations](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production).

The repository's existing `npm run lint` is blocked by ESLint 9 expecting a flat
configuration while only `.eslintrc.json` exists. Legacy-config mode also fails
because its declared `@typescript-eslint/parser` dependency is absent. The full
format check also finds existing formatting drift. These baseline tooling issues
are separate from this API change; changed files are checked with Prettier.

## Deployment runbook and release gate

Do not release [Flutter PR #511](https://github.com/Cherry-CIC/MVP/pull/511) until
an approved backend environment passes the following steps. Cloud Run's deployed
revision must be established independently; Swagger does not identify its source
commit. The implementation started from `main` at
`acf818eaa05c86e3356f1ba06440d967e52bae74`; live Swagger had no equivalent endpoint
when inspected on 20 September 2026.

1. Confirm the approved non-production project, native Firestore database,
   Cloud Run service/region and test accounts. Refresh authorised cloud credentials
   if needed. Remote database edition has not been verified from this workstation.
2. Set `PUBLIC_PROFILE_CURSOR_KEY` to 32 cryptographically random bytes encoded as
   canonical base64, supplied through the deployment's secret mechanism. Use one
   stable value across replicas/revisions. Do not commit a key. Rotation invalidates
   existing cursors; clients should reload the first page. No insecure fallback
   key or additional service-account permissions are used.
3. Review `firestore.indexes.json`: products collection, `userId ASC`, `status ASC`,
   `createdAt DESC`, document ID `DESC`. This repository previously had no tracked
   index configuration. First compare against the project's existing index
   inventory and preserve all unrelated indexes. Merge any existing definitions
   into the normal deployment inventory. Never use `--force` to delete indexes.
   With the reviewed inventory, deploy indexes only:

   ```bash
   npx -y firebase-tools@latest deploy --only firestore:indexes --project APPROVED_PROJECT_ID
   ```

   Wait for the index to become ready. Do not deploy or relax client security rules.

4. Build/deploy this branch's container through the approved Cloud Run workflow
   to non-production first. Keep Stripe sandbox, Sendcloud mock and email off for
   test environments. No established deployment workflow is committed here, so
   do not guess a production service or deploy against real records by default.
5. Use approved test accounts for sellers with active listings, no listings,
   unlisted/sold/zero-stock listings, missing/deleted sellers and several pages.
   Inspect actual response bodies against the strict user and product allowlists.
   Check 401, generic 404, cursor rejection and retryable failures.
6. Verify the deployed `/api-docs/` includes the exact public-profile route and
   `PublicUser`, `PublicProfileProduct`, pagination and response schemas.
7. Coordinate the production rollout before Flutter PR #511. Recheck the deployed
   [Swagger](https://cherry-backend-401854471349.europe-west2.run.app/api-docs/) and
   record the backend image/revision and index readiness.
8. On Flutter, open another seller's listing, check chosen username/avatar, open
   their profile, open a listing and navigate back to the correct profile and
   original listing. The app's emulator configuration can also support a separate
   local UI check; backend smoke checks do not claim to complete that UI journey.

Cloud deployment, remote index readiness and the Flutter device journey remain
release gates until their evidence is recorded. A successful local emulator run
is not evidence of production deployment.

## Reviewed migration plan

No migration is performed by this endpoint. The eventual target is one canonical
profile record per Firebase UID:

1. In an approved environment, inventory canonical and stored-UID-linked records,
   identify contradictions, missing usernames, duplicate public values and orphan
   Authentication accounts. Keep the inventory private; do not log profile data.
2. Back up the affected records and agree retention, rollback and conflict rules.
   Resolve contradictions with account owners or an authorised review. Never
   infer public usernames from email, private names or provider display names.
3. Merge reviewed public values into `users/{uid}` with idempotent, dry-run-first
   tooling and a recorded mapping. Do not overwrite a canonical chosen username
   with a legacy value automatically. Honour intended avatar removal.
4. In a separate reviewed change, update all profile writers/readers (including
   registration, editing and deletion) to use the canonical record consistently.
   Keep private fields segregated by access purpose. Do not relax Firestore rules.
5. Verify public/profile/checkout/deletion flows, then archive/remove duplicate
   records under the agreed retention policy. Remove the legacy repository lookup
   only after verification. Keep the public API contract unchanged.

## Verification recorded for this branch

- TypeScript build: passed.
- Configured backend Jest suite: 20 suites, 249 tests passed.
- Changed-file Prettier and Git whitespace checks: passed.
- Swagger generation with `failOnErrors: true`: passed, including exact public
  schema and route assertions.
- Real local Auth/Firestore emulator HTTP checks: 24 API responses and 714
  assertions passed, including recursive private-field rejection.
- Existing Flutter public-profile parser, view-model, widget and navigation
  suites: 40 tests passed. An empty temporary `.env` asset allowed the test bundle
  to build; it was removed afterwards. No Flutter source was changed.
- Repository-wide formatting: 49 existing files need formatting.
- Repository-wide lint: blocked by the pre-existing configuration/parser issues
  described above. No repository-wide cleanup was included.
- Remote deployment, deployed index/Swagger verification and a device journey
  against approved test accounts: pending approved environment details and valid
  cloud credentials. The emulator and Flutter tests are separate checks, not a
  claim of a deployed end-to-end device test.
