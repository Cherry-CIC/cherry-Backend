# Listing editing: implementation and release checklist

Status: implementation for review, with editing disabled by default. This is not
production deployment approval. Frontend reference: Cherry-CIC/MVP PR #525 at
`92ed86bbcb74a6ddbc741abb7730ac11770933ae`; backend base: `eedbbb6`.

## Contract

`PUT /api/products/{id}` accepts a sparse object with a required integer
`expectedEditVersion` and at least one of `name`, `description`, `categoryId`,
`quality`, `size`, `product_images`. Unknown fields are rejected, including charity,
price, donation, stock, postage, ownership, likes and lifecycle fields. Title is
trimmed, 3–100 characters; description is optional and clearable, up to 500.
Conditions match the Give form: NEW, EXCELLENT, GOOD, FAIR, WORN, TEXTILES. Sizes:
XS, Small, Medium, Large, XL, XXL, One Size. Unchanged legacy values may remain;
new submitted values must follow this vocabulary. Existing category is checked
inside the transaction.

The same transaction verifies owner, positive stock, active/unlisted status,
`editSafetyVerified === true`, no `paymentReservationId`, no `hasSales` and no
order of any status for the product. It checks and increments `editVersion`.
Cancelled or refunded orders do not restore editability. Failures leave the
listing unchanged. Success retains the existing envelope with `data.id` and the
committed `data.editVersion`. Canonical, feed, search, profile, liked-item and
mutation responses use the same version exposure gate. Internal reservation and
certification fields are removed from API responses.

`LISTING_EDIT_ENABLED=false` disables edits and hides versions. Set it to true
only after all deployment prerequisites below pass. Do not deploy versions as a
standalone early migration. Missing or malformed versions stay unavailable for
editing. Swagger describes fields, validation and structured `code` errors.

Availability changes and sales also increment the version. Unlist/relist/delete
are owner-checked transactions and cannot run during a reserved payment. Legacy
uncertified listings cannot be changed or deleted until reviewed. Purchased
listings cannot be deleted. Likes do not advance versions. Account deletion
preflights pending checkouts and uncertified listings, then writes a permanent
`account_deletions/{uid}` tombstone. Product creation and reservations read that
tombstone transactionally; product cleanup checks reservation and history again.
Sold descriptions/media remain retained when the seller is anonymised.

## Payment coordination

Reservations operate even while the editing flag is off. One buyer at a time
can reserve a listing, including multi-unit listings. This intentionally
serialises checkout for the MVP.

1. Obtain a server-side shipping quote and Stripe customer ID.
2. Transactionally compare the quoted version, optional buyer version, owner,
   lifecycle, stock and account-deletion tombstones. Create a durable
   `listing_payment_reservations` record and set the product reservation pointer.
   Increment its version for the availability change.
3. Create the Stripe intent outside the transaction using the reservation ID as
   the idempotency key. Store the returned intent ID before returning any client
   secret. Pricing, shipping selection, customer and metadata are frozen in the
   reservation so retries use identical Stripe arguments.
4. Same-buyer/same-selection retries reuse the reservation. Other buyers are
   blocked. If creation times out or attachment fails, retain the lock. Retry the
   same idempotency key only within 23 hours. After that, require operator
   reconciliation and never recreate an uncertain payment automatically.
5. Signed webhooks retrieve current Stripe state. Failure/requires-payment-method,
   requires-action and processing do not release the lock. Success permanently
   records `hasSales`; the lock remains until the paid order transaction consumes
   one unit. Duplicate callbacks and order submissions do not duplicate sales.
6. `POST /api/payment/cancel-payment-intent` with an owned `paymentIntentId`
   cancels at Stripe first. Release only after confirmed `canceled`. Expiry is
   30 minutes, checked on the next checkout attempt; it requests cancellation,
   never deletes a lock on a timer. If confirmation races with cancellation,
   Stripe's resulting state decides; success/processing remains protected.

A missing buyer version is accepted only on never-edited products (or a retry of
that same already-bound reservation). After any edit the client must supply a
version. A missing supplied version is never silently removed by the validator.
An old client can therefore be asked to upgrade/refresh instead of buying unseen
changed details. A stale explicit version always conflicts.

The paid order transaction verifies the reservation/intent/buyer binding, consumes
stock, advances the version, permanently records sale history, releases the
reservation, and writes the existing payment-to-order deduplication record.
Retries return the existing order before repeating external shipment creation.
Shipment creation recovery after a process crash remains an operational concern:
a paid order with no shipment must be reconciled by the existing fulfilment
process, not by charging again. The webhook does not create a shipping order
because the current intent metadata does not contain the buyer's complete address.

A lock stuck in `creating` beyond 23 hours needs Stripe Dashboard/API review by
reservation metadata and idempotency request logs. Attach any discovered intent
and reconcile its current state. If no intent is found, absence must be proven
before removing the lock. Never release merely because a query returned no rows,
a request timed out, or an intent is in `requires_payment_method`.

## Previously issued intents and migration

Do not certify legacy records based only on remaining stock or absent orders.
Previously issued intents can still succeed and have no reservation. The code
blocks edits, deletion, unlisting and account deletion for uncertified products.
Legacy success events set `hasSales`, and successful legacy orders remain
processable. Rejecting an order after charge is not the safety mechanism: rollout
must prevent editing while any legacy intent can still succeed.

The live database edition, rules, indexes, bucket, existing intent inventory and
Firestore/Storage access policies were not verified: the local Firebase login
was expired and no target project/database was confirmed. Existing repository
code uses the Native Firestore SDK; tests use local emulators. Verify the actual
edition/database before applying any migration or rules.

Migration procedure, requiring separate authorised staging and production runs:

1. Back up affected documents and export deployed Firestore/Storage rules and
   relevant IAM policies. Record the database ID, bucket and active Cloud Run
   revisions. Inventory every writer, including old revisions and admin scripts.
2. Stop new checkout creation during cutover and drain old Cloud Run revisions.
   Deploy reservation-aware code with editing OFF. All traffic must use the new
   writer; mixed old/new writers and rollback to the old writer are unsafe.
3. Enumerate ALL relevant Stripe intents using paginated authoritative API lists
   and existing order records, not eventually consistent search alone. Cancel
   actionable legacy intents and confirm terminal cancellation; settle succeeded
   intents into retained orders/sale markers. A processing or untraceable intent
   leaves its listing uncertified and uneditable. Reconcile legacy orders before
   allowing new checkout on their listing to avoid overselling across generations.
4. Reconcile stock/status, owner, media and sale history. For each product, in a
   transaction that reads current product, order history and reservation state,
   initialise missing `editVersion` to 0 (never reset an existing version), store
   explicit lifecycle status and set `hasSales` for ANY historical sale/order.
   Set `editSafetyVerified=true` only after all legacy payment and ownership
   evidence is resolved. Record reviewer, evidence and original document version
   in a separate server-owned migration audit record. Conflicting records must
   be re-reviewed. This PR intentionally does not provide an unattended script
   that certifies live data based on unverifiable assumptions.
5. Validate both existing and new media using the policy below. Unknown ownership
   or unresolved payment means keep certification false. Complete migration of
   valid read versions before enabling the global exposure flag; no fabricated
   version or lifecycle state should make unsafe records eligible.
6. Verify direct client writes cannot bypass any protected collection. Confirm
   backend service-account IAM, deployed rules and Storage retention/lifecycle
   policies. Reopen checkout only after legacy reconciliation and writer cutover.
7. Run the complete staging exercise, then authorise backend flag activation and
   a separate reviewed frontend release. Keep the frontend flag off until then.

The new transaction queries use single-field productId/userId indexes. No new
composite index is required by these changes; existing product/feed indexes must
remain. Do not configure TTL deletion on active reservations or media evidence.

## Media ownership and retention

Use 1–10 distinct photos, at most 10 MiB each, JPEG/PNG/WebP, non-animated, at most
40 million pixels. The first URL stays the main photo; order is preserved.
Backend checks approved HTTPS Firebase Storage origin/bucket, exact object path,
download token, metadata, existence, object generation, bounded byte count and
actual decoding with sharp. External URLs, other users' paths, duplicate objects,
spoofed types and unverified ownership are rejected.

New uploads use `listing-media-v1/{uid}/{unique-id}.{jpg|jpeg|png|webp}` with
explicit content type and custom metadata `{ownerUid: uid, mediaPolicy:
'listing-v1'}`. The proposed rules enforce those values at authenticated creation
and forbid overwrite, metadata mutation and deletion. Client metadata alone is
not proof. Set `LISTING_MEDIA_RULES_VERIFIED=true` only after verification of the
deployed rules and IAM. Set `LISTING_MEDIA_POLICY_START` to a recorded instant
AFTER the immutable rules took effect; objects created before it are rejected,
including attacker-preseeded objects. `LISTING_MEDIA_BUCKET` names the one approved
bucket. These values must be present before editing can validate photos.

Retained legacy `products/{uid}/...` photos are accepted only if already on the
listing AND a server-owned provenance record exists at
`listing_media_ownership/{sha256(bucket + '/' + objectPath)}` with fields
`ownerUid`, `bucket`, `path`, `generation`. Create these records only from reviewed
upload/audit evidence. The supplied URL, path, present owner field or uploader-
controlled metadata is insufficient. If evidence is unavailable, the owner must
upload replacements under the protected namespace. No files are deleted by this
implementation, including when a photo is removed from a listing.

Conservative cleanup policy: retain removed/replaced/abandoned uploads for at
least 30 days. Before any separately authorised cleanup, build a dry-run candidate
report; exclude every object referenced by any live/unlisted/sold listing, any
historical order, any reservation or migration/provenance record, and every
legacy or ownership-ambiguous object. Recheck references and generation immediately
before deletion and prevent concurrent attachment (maintenance window or a
transactional media-claim protocol). A grace period and one reference scan alone
are insufficient. There is deliberately no unattended deletion job in this PR.
Disable bucket lifecycle rules that can delete referenced media.

## Firebase emulator fixtures and production compatibility

`security/firestore.rules` and `security/storage.rules` are listing-only emulator fixtures,
not deployable app policies or evidence of what is deployed. `firebase.listing-test.json` is an explicit
emulator configuration, not production configuration. Never deploy it blindly.

The Firestore fixture denies direct access to server-owned product/payment/order
state. It deliberately does not define unrelated profile, address or locker policies. Backend Admin SDK uses IAM and
bypasses these rules. Remove ALL broader overlapping grants when integrating;
adding a restrictive match beside an existing permissive wildcard does not help.
Storage prevents product overwrite/deletion even by the original uploader.
Rules checks passed for ownership, missing metadata, object size, overwrite,
metadata alteration and deletion. Backend byte validation remains essential.

Required compatibility review when integrating equivalent protections into live rules:

- `UsernameService.getUsername` reads other users' private users documents and
  `isUsernameTaken` queries them. Route public-profile reads through the existing
  public API; implement a safe username-availability/reservation contract rather
  than reopening private document reads.
- `FirestoreService` directly queries products and has user/locker/address write
  paths. Route product reads through the existing API; audit and explicitly
  preserve validated owner-only address/locker/profile fields in production
  rules, or move these paths behind authenticated endpoints. Preserve unrelated
  working access policies; these fixtures are not a replacement for them.
- Profile uploads currently use a first-name-derived shared `user_images` path.
  Review its access policy separately; do not replace it with the default-deny
  Storage fixture. Do not weaken the product-media namespace to support it.
- Both new-listing uploads and editing uploads must adopt the protected namespace,
  content type and metadata. Current PR #525 uploads `products/{uid}/edit_*`
  without ownership metadata and can retain HEIC/HEIF. Convert these to supported
  images and enforce the count/byte/pixel limits before uploading. Re-upload
  legacy photos that lack reliable provenance.
- Call the cancellation endpoint when a buyer abandons a known payment intent.
  Retry recovery/expiry remains safe without this call but can hold stock for
  longer. Handle structured 409 codes by refreshing and requiring review; do
  not silently resubmit edits or repeatedly request payment intents.

Historical order UI still enriches from current products. Therefore all sold and
partially sold listings stay permanently uneditable, including after cancellation
or refund; this PR does not claim that backend-only snapshots fix that UI.

## Validation and rollout

Local commands (Node 20.9+ for sharp, Java 21+ for current Firebase emulators):

```sh
npm install
npm run build
npm test -- --runInBand
npx -y firebase-tools@latest emulators:exec --project demo-cherry-listing --config firebase.listing-test.json --only firestore,storage 'npm run test:integration'
```

Use a `demo-` project and localhost emulators. Integration tests refuse to run
without a local Firestore emulator. They cover sparse fields, invalid requests,
owner checks, stale versions, simultaneous edits, edit/payment races, competing
buyers, reservation retries, failure/expiry/cancellation, duplicate/late success,
partial sales, legacy certification, order deduplication, account deletion and
client-rule bypass attempts. Unit tests decode real image bytes and cover HTTP
response contracts. Stripe calls are mocked locally: actual test-mode Stripe and
mobile upload flows still require staging.

Staging acceptance: two owner/buyer sessions, each editable field and photo order;
one failed and one abandoned upload; two concurrent edits; stale buyer version;
legacy/no-version client; simultaneous edit/checkout; competing buyers; 3DS and
processing; cancellation racing confirmation; timeout during Stripe creation and
DB attachment; expired/unknown lock; success webhook before/after order POST;
duplicate order POST/webhook; cancelled/refunded partial-sale history; direct
Firebase requests; new and retained photos; other-user profile and username,
address/locker and account deletion journeys. Verify webhook delivery and recovery
alerts. Confirm API readback shows committed versions everywhere and order media
remains stable. Do not enable the frontend flag until these pass.

Rollback: disable frontend editing and `LISTING_EDIT_ENABLED` first. Retain the
reservation-aware payment/order code, versions, sale markers, tombstones,
provenance and immutable media rules. Never roll back to the original unguarded
writer while new intents can succeed. Drain or cancel actionable payments and
reconcile orders before a code rollback that changes reservation semantics.
Do not reset versions, remove locks or restore permissive Firebase rules.

## Scope audit (4 October 2026)

The audit reduced the change from 41 to 39 files. It removed the unrelated global
401 response change, unused Firebase initialisation branch, profile-access policy
and incidental order-test formatting. Authentication retains the existing 401
envelope; listing validation, ownership and conflict errors retain their codes.
The rule files are emulator fixtures only. Production integration must preserve
unrelated app access and remove any overlapping grants that bypass listing safety.

The remaining changes serve these requirements:

| Area | Reason retained |
| --- | --- |
| Product validation, transactions and projections | Sparse edits, ownership, version conflicts and consistent reads |
| Media validation and immutable Storage tests | Ownership, valid images and historical photo retention |
| Payment reservations, cancellation and webhooks | Prevent edits while a payment can still succeed |
| Order transaction and replay response | Prevent duplicate sales and inventory decrements |
| Lifecycle and account deletion | Prevent deletion or availability changes bypassing payment locks |
| Swagger, configuration, tests and release guide | Document and verify the contract and deployment prerequisites |

A repeated cancellation after legitimate listing deletion now returns successfully
using the recorded terminal payment state. A regression test covers this sequence.
No safety check was removed to reduce the file count.

Deployment remains blocked. With editing disabled, checkout still uses reservations
and uncertified legacy listings cannot be unlisted, deleted or removed through
account deletion. This requires a planned cutover, not an ordinary flag-off deploy.
Abandoned reservations need cancellation, a later checkout attempt or operator
reconciliation; there is no background expiry worker. Completed payments with
missing orders/shipments require recovery, never another charge. Existing order
retries also depend on the retained product/postage configuration, so changing
postage configuration during reconciliation needs an operational review.

## Review evidence and limitations

The final review includes TypeScript compilation, the repository unit suite,
Firestore/Storage emulator concurrency and rule tests, and generated Swagger
schema checks. Lint invocation is blocked by the repository's pre-existing ESLint
9 configuration mismatch (only `.eslintrc.json`, no flat config); no autofix was
run. The existing Firebase client dependency tree reports npm audit advisories,
including a nested grpc-js issue; the new rules test helper inherits that same
Firebase peer dependency. A broad dependency upgrade is outside this change and
must be reviewed separately before calling the entire backend production-ready.
No live Stripe payment, database migration, Firebase rule deployment, Cloud Run
deployment or frontend flag change was performed.

Recorded local result for this branch: TypeScript build passed; 274 unit tests
passed across 22 suites; 56 integration/rules tests passed against Firestore and
Storage emulators; generated Swagger schema checks and `git diff --check` passed.
These results do not substitute for the staging or deployed-rule checks above.
