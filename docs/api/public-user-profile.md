# Public seller profiles

`GET /api/users/{userId}/public-profile?limit=20&cursor=...` requires a Firebase
bearer ID token. `userId` is a Firebase UID, not an internal document ID.
The exact contract, example, validation limits and error schemas are maintained
in [Swagger JSDoc](../../src/modules/users/routes/userRoutes.ts).

Responses contain exactly `{ success, data: { user, products }, meta }`. The user
appears even on empty pages. Limit defaults to 20 (range 1–50); `nextCursor` is
always present and is null when `hasMore` is false. Responses use
`Cache-Control: private, no-store`. Unknown query fields cannot override policy.
Unavailable accounts return generic 404; operational failures remain retryable 503. Logs and authentication errors do not expose raw Firebase exceptions.
There is no existing application blocking/rate-limit system; deployment controls
may supply 403/429. This change adds neither a blocking system nor IAM permissions.

## Identity and privacy decisions

`PublicUserRepository.getByFirebaseUid` owns profile resolution:

1. Require an existing, enabled Firebase Authentication account. Only missing or
   disabled accounts become unavailable; operational errors propagate.
2. Read selected fields from `users/{uid}` and records whose stored `id` equals
   the UID. Exclude the canonical document from legacy candidates. Contradictory
   `id` or `firebaseUid` fields make the profile unavailable.
3. Prefer trimmed canonical `username`, then an unambiguous legacy `username`,
   otherwise `User`. Avatar precedence is canonical `profileImageUrl`, `photoURL`,
   `photoUrl`, then the same legacy aliases. Invalid aliases fall through; require
   HTTP(S), a host and no embedded credentials, otherwise return null.
4. Conflicting non-empty legacy usernames or valid avatars make the profile
   unavailable, even with canonical values. Consistent duplicates and absent
   values may combine. More than 20 linked records requires review, not arbitrary
   selection.

The user allowlist is **only `id`, `username`, `profileImageUrl`**. Flutter collects
Username and First Name separately; social login can put a provider's full name
in `firstname`. Neither `firstname`, `displayName` nor email has established public
provenance, so none is used as a fallback. Authentication records never leave the
repository, and private nested records never enter the response DTO.

## Listing and pagination decisions

Force the owner and `status == active`, then recheck each record before mapping.
Require positive integer stock and valid required Flutter fields. Missing/unknown
status is excluded. Legacy listings lack publication fields; absent fields retain
the active-and-in-stock rule. Explicit fields are handled defensively:

- `visibility`: only `public`; `moderationStatus`: only `approved`;
  `publicationStatus`: only `published`.
- Any `moderation` or `publication` object is excluded pending a reviewed schema.
- `deleted`, `isDeleted`, `removed`, `isRemoved`, `hidden`, `isHidden`,
  `moderationHidden`: absent or false only.
- `deletedAt`, `removedAt`, `hiddenAt`: absent or null only.

No publication fields are written or migrated. Future moderation changes must
update the predicate and cursor policy version. Only permitted products receive
`visibility: public`. The product DTO includes required detail/checkout fields,
calculated `securityFee` and optional category/charity IDs, never nested relations.
Stored price/donation are preserved; fees use existing GBP/pence checkout helpers.
Missing description/likes default to `''`/0. Invalid required fields or timestamps
are excluded, invalid image URLs removed, and missing `createdAt` is excluded by
Firestore ordering. Stored identifiers are never normalised into other IDs.
Damaged records require separate review; monetary values are never invented.

Order by `createdAt` descending, then document ID descending, preserving timestamp
nanoseconds. Scan chunks of 100 until `limit + 1` eligible records or exhaustion.
Only the last returned public record can anchor the next cursor; excluded records
cannot produce misleading empty pages or `hasMore`. Exhausting the 5,000-record
budget returns 503, not a partial page. Persistent exhaustion requires data review.

AES-256-GCM cursors bind seller, viewer and policy, expire after 24 hours and are
invalidated by key rotation/policy changes. Inventory is not a frozen snapshot:
sold/hidden records disappear; new records before the cursor appear on refresh.

## Verification

```bash
npm install
npm run build
npm test -- --runInBand
FIREBASE_PROJECT_ID=demo-cherry-profiles npx -y firebase-tools@latest emulators:exec \
  --project demo-cherry-profiles --config firebase.emulators.json \
  --only auth,firestore 'node scripts/test-public-profiles-emulator.js'
```

Use Java 21+ and fictional accounts. The script requires the exact demo project
and numeric IPv4 loopback emulator hosts, sets inert service configuration and
cleans up only uniquely prefixed fixtures. Local rules deny client access and are
not part of deployment configuration. Admin SDK checks enforce server filtering.
[The emulator does not enforce composite indexes](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production).

Recorded checks: build, 20 backend suites/249 tests, strict Swagger generation,
24 emulator HTTP responses/714 assertions, and 40 existing Flutter parser,
view-model, widget/navigation tests passed. The temporary empty Flutter `.env`
asset was removed; no Flutter source changed. New files pass Prettier; existing
shared files retain their original formatting to minimise review churn.
Repository lint remains blocked by the existing ESLint 9/legacy-config mismatch
and missing `@typescript-eslint/parser`; repository-wide formatting has existing
drift. No unrelated tooling cleanup is included.

## Deployment and release gate

Started from `main` at `acf818eaa05c86e3356f1ba06440d967e52bae74`. Live Swagger had
no equivalent endpoint on 20 September 2026, but does not establish the deployed
Cloud Run revision. Remote database edition remains unverified. Cloud deployment,
index readiness, deployed Swagger and the actual device journey are **pending**;
local tests do not establish those outcomes.

1. Confirm the approved non-production project/database, Cloud Run service/region
   and test accounts; refresh cloud credentials. No deployment workflow is
   committed, so do not guess a production target.
2. Supply `PUBLIC_PROFILE_CURSOR_KEY`: 32 random bytes in canonical base64, via the
   deployment secret mechanism, consistent across replicas. Never commit the key.
   Rotation invalidates cursors; clients reload page one. There is no fallback key.
3. Review the committed products index: `userId ASC`, `status ASC`, `createdAt DESC`,
   document ID `DESC`. This is the first tracked index configuration: reconcile
   it with the remote inventory and preserve unrelated indexes. Never use
   `--force` to delete indexes. Deploy the reviewed inventory only, then wait for
   readiness; do not deploy or relax client rules:

   ```bash
   npx -y firebase-tools@latest deploy --only firestore:indexes --project APPROVED_PROJECT_ID
   ```

4. Deploy the branch container to non-production through the approved workflow.
   Keep Stripe sandbox, Sendcloud mock and email off. Check approved sellers with
   active/no/unlisted/sold/zero-stock listings, missing/deleted accounts and multiple
   pages. Inspect network bodies for private fields and verify auth/cursor/error
   handling. Verify `/api-docs/` exposes the exact route and public schemas.
5. Coordinate backend production rollout before [Flutter PR #511](https://github.com/Cherry-CIC/MVP/pull/511).
   Record image/revision and index readiness, and verify
   [deployed Swagger](https://cherry-backend-401854471349.europe-west2.run.app/api-docs/).
   On a device, open another seller's listing, check username/avatar, open their
   profile, open a listing and navigate back to the correct profile/original listing.

## Reviewed migration plan

No migration, registration, `my-products`, UGC or Community Rules changes are
included. The eventual target is one canonical profile record per Firebase UID:

1. Privately inventory canonical/linked records, identity conflicts, duplicate
   public values, missing usernames and orphan accounts in an approved environment.
2. Back up records and agree retention/rollback/conflict rules. Resolve ambiguity
   with account owners or authorised review, never by deriving names from email
   or private/provider names.
3. Merge reviewed public values into `users/{uid}` using idempotent, dry-run-first
   tooling and a recorded mapping. Preserve canonical usernames and intended
   avatar removal.
4. Separately update all writers/readers, including registration, editing and
   deletion. Segregate private fields; do not relax Firestore rules.
5. Verify profile, checkout and deletion flows before retiring duplicate records
   under the retention policy. Remove legacy lookup only after verification,
   preserving the public API contract.
