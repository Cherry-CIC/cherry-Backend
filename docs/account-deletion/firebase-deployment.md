# Firebase, deployment and operations handover

## Status and authority

The implementation is being integrated on branch `codex/account-deletion` from GitHub main `eedbbb6`. Work began in a supplied archive without Git metadata; its original source was preserved at `/tmp/cherry-deletion-baseline/backend-before.tgz`. The current checkout resolves the repository baseline, but equivalence to the deployed service remains unverified. See [verification](verification.md) for the distinction between historical archive results and current integration checks. No real account has been deleted, no live rules or IAM changed, and no production job enabled.

The supplied app configuration points at `https://cherry-backend-401854471349.europe-west2.run.app`, uses real data and disables Firebase emulators. It does not identify an authorised staging project. Initial Firebase CLI discovery failed because the local sign-in had expired. Sign-in was refreshed on 5 October 2026 and read-only metadata discovery succeeded that day. A further live check on 6 October found the CLI credentials invalid again; remaining remote checks are blocked pending refreshed access. Only `cherry-mvp` (project number `401854471349`) is visible; its number matches the supplied backend URL. This does not establish an authorised staging environment. Its `(default)` database is **Standard edition**, Firestore Native, in `europe-west2`; PITR is disabled and the reported version-retention window is one hour. Installed extension/function and index metadata have been inspected in the [read-only cloud preflight](cloud-preflight.md). Deployed rules, runtime IAM, bucket lifecycle and the backend revision remain unverified. No new database or cloud resource was created.

The frontend archive has a rule granting all Firestore access until 31 December 2030. This is evidence about that local file only, not deployed rules. Such a rule would defeat all account deletion restrictions. The new rules are a complete restrictive **prototype** for testing and review. Never append them to a permissive wildcard, since rules allow permissions additively.

## Implemented components and boundaries

The local components below have historical archive test coverage where stated. Integration with main adds per-user likes and public-profile restrictions; current checkout validation must be recorded in [verification](verification.md) before treating the code review as complete. None of these statuses establishes deployed behaviour.

| Item | Status | Detail |
| --- | --- | --- |
| Durable API request, UID guard and private receipt | Implemented, emulator verified | Guard and request commit atomically. Normal APIs and writes consult guards independently of the enablement flag |
| Worker and expiry processing | Implemented, emulator verified | CLI job; bounded discovery pages, durable checkpoints, 15-minute renewable lease, retry codes, per-job progress; no detached web-request processing |
| Authentication | Implemented, emulator verified | Refresh tokens revoked, user disabled then removed after durable recovery context is saved |
| Apple authorisation | Implemented, mocked verification only | Server exchanges code, binds subject to linked Firebase Apple identity, encrypts refresh token, revokes and erases token. Actual Apple environment unverified |
| Owned media | Implemented, emulator verified | UID prefixes `products/{uid}/` and `user_images/{uid}/`; nested variants included. First-name legacy profile paths become ownership review tasks |
| Firestore/Storage rules | Implemented prototype, emulator verified, unapplied | Private profiles and retained records protected, ownership checks, deletion guard blocks stale clients. Current direct collection queries require frontend migration |
| Order and checkout protection | Implemented, emulator verified | Buyer and seller inventory; durable pre-provider checkout context; unresolved payments are holds; no refunds, payment cancellations or payouts caused by deletion |
| Stripe extension customer-tree adapter | Implemented, emulator verified; extension unchanged | Captures mapping candidates, requires evidence-bound review, recursively removes approved trees and reopens review on later data; deployed writers remain a release gate |
| Recipient/export handling | Implemented review outbox; external work required | Restricted tasks hold completion until evidence is recorded. No claim that Stripe, Sendcloud, Resend, carriers or downloaded exports have already erased data |
| Backups, PITR, object versions, soft-delete, log retention | Partly inspected; changes unapplied | Current database PITR is disabled with a one-hour version window. Other recovery copies and external logs remain unverified; live-object deletion does not establish their erasure |
| Scheduler, alerts, service accounts, secrets | Required but unapplied | Use existing deployment infrastructure where possible; no new paid infrastructure was provisioned |
| Flutter, deletion webpage and store declarations | Handover only | Explicitly outside implementation scope; complete the linked integration checklist before enablement |

## Current extension and collection inventory

Read-only discovery confirmed Stripe extension `0.3.4`, configured to synchronise new Authentication users into `customers/{uid}` and leave Stripe Customers undeleted. Both deletion callbacks are gated by the exact `Auto delete` setting in the versioned source, so the observed `Do not delete` prevents automatic Stripe Customer deletion through either callback. It does not remove the Firestore customer tree. See [the exact source, paths and safeguards](cloud-preflight.md#stripe-extension-034-source-findings).

The tree may contain checkout sessions, payments, subscriptions and nested invoices. Its creator uses Stripe metadata `firebaseUID`; this backend uses `firebaseUid`. Use the [Stripe extension review contract](#stripe-extension-review-contract) for verified mappings, active obligations and delayed callback handling. Do not enable automatic Stripe deletion as a shortcut, since it can cancel subscriptions. The extension's privileged writes bypass client rules and do not consult the new account guard.

GitHub main `eedbbb6` establishes the `user_likes` schema and liked-item endpoints that were absent from the original archive. `ProductLikeRepository` stores `userId`, `productId` and `createdAt` under a derived relationship ID. The integrated worker removes the closing user's likes and relationships to their products, reconciles counters transactionally and prevents new likes involving a restricted account. Public-profile reads also consult the guard. Remote index metadata still names `product_listing`, whose writers and ownership remain unresolved. Confirm the deployed revision and all active paths before release; an index name alone does not justify destructive queries against guessed owner fields.

## Runtime configuration and fail-closed gates

Defaults in `.env.example` are `ACCOUNT_DELETION_MODE=disabled` and `ACCOUNT_DELETION_WORKER_ENABLED=false`. Neither acceptance nor destructive processing uses implicit retention defaults.

`ACCOUNT_DELETION_POLICY` is a JSON object containing `policyVersion`, `orderEvidenceMonths`, `financialYears`, `financialYearEndMonth`, `financialYearEndDay`, `auditDays`, `backupDays`, `reviewDays`. All numeric values are validated integers; fiscal year-end must be a valid date. The audit is limited to 8-365 days after final completion, and the operational review interval to 1-28 days. The audit period must be at least the configured backup horizon (`backupDays`), preventing application suppression state from expiring earlier. The eight-day minimum also covers the one-week lifetime of pre-existing resumable upload sessions. The worker sweeps owned media again during review and after completion until audit expiry. [Cloud Storage resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads). These are implementation bounds, not legal recommendations.

Emulator mode requires a `demo-` project plus loopback Authentication, Firestore and Storage emulator hosts. Production mode additionally requires `ACCOUNT_DELETION_APPROVED_POLICY` equal to the policy version and `ACCOUNT_DELETION_READINESS` containing non-empty evidence references of at least eight characters for each of:

`policy`, `firestoreRules`, `storageRules`, `inventory`, `extensions`, `providers`, `backups`, `scheduler`, `alerts`, `support`, `frontend`, `apple`.

These references are organisational attestations, not automated legal certification. Store real reviewed evidence; do not enter placeholder strings to bypass the gate. Jobs pin their complete policy snapshot and version. A changed configured period or version stops old jobs for policy review instead of silently changing their retention rules. Migration needs a separately reviewed plan.

`ACCOUNT_DELETION_ENCRYPTION_KEY` is a base64 32-byte encryption key. `APPLE_CLIENT_ID` must match the Apple sign-in audience for the supported client. `APPLE_CLIENT_SECRET` is a currently valid Apple client secret. Store both secrets in Secret Manager and restrict access. Preserve the encryption key until pending tokens have been revoked, then rotate with a migration strategy. Multiple Apple audiences require deliberate configuration support before rollout; the implementation currently supports one configured audience.

The receipt is generated by the client using 32 cryptographically random bytes, base64url encoded to 43 characters, and saved before submission. Only its SHA-256 digest is stored. It is valid for 90 days from request receipt. The secret alone can recover a lost acceptance response; the reference alone grants nothing. A separate minimal receipt survives earlier private audit expiry without retaining the UID or operator context. Later rights enquiries or lost receipts use independently verified support. Secure status is the implemented completion check; email sending is not configured.

## Data structures and access

- `account_deletion_guards/{uid}` is the authoritative restriction. Clients cannot write/read it directly. It survives Authentication deletion until final audit expiry.
- `account_deletion_requests/{uuid}` holds only restricted job context, deadlines, receipt digest and policy version/snapshot. Its `cleanup`, `cleanup_orders`, `cleanup_products`, `cleanup_contexts`, `tasks`, `holds` and `operational` subcollections are server-only.
- `account_deletion_receipts/{uuid}` holds only limited status dates/state and the receipt digest after private audit expiry, when needed to honour the original 90-day status lifetime. The worker deletes expired receipts in batches of 100. Clients have no direct access.
- `account_checkout_contexts/{uuid}` records both parties, immutable checkout selection and minimal temporary operational contact before a Stripe request. Client secrets and ephemeral keys are never saved here. Context creation serialises against both account guards. Provider timeouts preserve context as `needs_review`. The snapshot includes the original charity allocation and postage selection. Listing deletion and financial/inventory changes are blocked transactionally while unresolved checkouts exist. Pending seller listings retain only fulfilment fields; arbitrary descriptions and media URLs are removed. Verified terminal outcomes are copied to each existing deletion job before shared context erasure.
- `account_retained_orders/{orderId}` separates whitelisted evidence from financial fields with independent expiry. Evidence may contain UIDs and is personal data. It is never public or accessible through the deletion receipt.
- `account_deletion_worker_state/scan` stores only a scan cursor. The worker scan uses single-field indexes on IDs, receipt hashes, expiry dates and array membership; these must not be disabled. `firestore.deletion.indexes.json` includes `account_checkout_contexts.productId + state` for transactional listing protection. Confirm index readiness in staging; emulators do not enforce production index requirements.

An active order retains fulfilment/contact information only in private operational records until resolution. The removed profile and ordinary listings are not prerequisites for completing the order. A terminal record requires verified creation/completion dates and no explicit financial/legal hold. The existing `buyerDisputeStatus=under_review` is an operational hold; deletion must preserve necessary case evidence until resolution. A cancelled paid order additionally requires evidenced financial reconciliation. Resolving a missing-date task alone cannot release its operational hold. Current main protects the Sendcloud webhook with HMAC signature verification. The handler updates shipment/order state but does not record the independently verified completion date required by retention. A valid signature also does not establish financial settlement. Support must use `review-order` where that evidence is missing; deployed signature configuration still needs verification. Completed live orders are minimised, with a marker preventing delayed repository/webhook updates from reintroducing personal data. Expiry applies to both private evidence and corresponding live fields. Once both periods expire, provider/payment/product links, financial amounts, shipment documents and deletion-request pseudonyms are removed. Only the remaining counterparty UID and order state survive in a minimal history shell. That shell is removed when its remaining participant deletes their account. Later explicit financial/legal holds stop scheduled expiry. A seller request does not trigger erasure of the active buyer's Stripe Customer or parcel while their order evidence is still required.

The worker has no implementation for speculative messaging, trust scores or payouts absent from this source. The verified Stripe extension is an actual separate payment-data path and must be covered by the extension adapter and rollout evidence described above. The frontend defines a report collection name without observed writes. Production inventory must identify any actual extra collections/services and add an adapter before enablement. A reference in a policy is not evidence that an integration exists.

## Permissions and deployment

Use an existing dedicated runtime identity or create a least-privilege service account through the organisation's deployment process. No production keys are needed in chat. For the worker, the necessary API permissions include:

- Authentication: `firebaseauth.users.get`, `firebaseauth.users.update`, `firebaseauth.users.delete` (revocation and disabling are updates).
- Firestore: `datastore.entities.get`, `list`, `create`, `update`, `delete`, plus database metadata access required by the SDK. These server SDK permissions bypass Security Rules. Separate deployment permissions from runtime permissions.
- The specific media bucket: `storage.objects.list`, `get`, `delete`; API/other app flows may separately require create/update. Do not grant bucket administration to the deletion worker.
- Access only to required Secret Manager versions, plus the existing application logging permissions. Use a narrower custom role if organisational IAM allows; verify SDK behaviour with the staging identity.

Firestore/Storage rule deployment uses deployment IAM, not the runtime identity. Cross-service Storage rules need the documented service-agent permissions to read the Firestore guard. Verify those in staging. [Firebase Storage rule conditions](https://firebase.google.com/docs/storage/security/rules-conditions)

Read-only discovery commands for the eventual authorised staging project:

```sh
npx -y firebase-tools@latest firestore:databases:list --project STAGING_PROJECT
npx -y firebase-tools@latest firestore:databases:get '(default)' --project STAGING_PROJECT
npx -y firebase-tools@latest ext:list --project STAGING_PROJECT
```

Recheck the confirmed extension/functions and inspect any additional Authentication deletion triggers, Storage image extensions, bucket versioning/soft-delete, scheduled Firestore backups, export jobs and existing CI in the eventual staging project. Current-project PITR metadata alone does not establish recovery-copy retention. A deletion trigger must not erase required order evidence when Authentication is removed. An image extension must not recreate thumbnails after source cleanup. This is a release prerequisite.

After separately authorising a specific staging deployment, review and merge the rules with the full application model. These commands are templates and **have not been run**:

```sh
npm ci
npm run build
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes,storage --config firebase.deletion.json --project STAGING_PROJECT
gcloud run jobs deploy cherry-account-deletion --image REVIEWED_IMAGE --region europe-west2 --project STAGING_PROJECT --service-account WORKER_SERVICE_ACCOUNT --command node --args dist/scripts/accountDeletion.js,run,--apply --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 900s
```

Reuse the backend's existing image/deployment workflow for the API. No `.github/workflows` directory is present in this checkout; identify the actual build and deployment process before release. Bind the approved environment values and secrets to the job separately; do not put secrets into shell history. Configure an existing scheduler to invoke the private Cloud Run job every few minutes with an identity authorised only to execute that job. If no scheduler exists, obtaining one is an external deployment decision. Monitor schedule execution and queue age; the code alone cannot make an unscheduled job run.

Configure Cloud Logging alerts for `account_deletion_retry`, `account_deletion_attention`, failed job executions and absence of expected `account_deletion_worker_finished` events. Attention events carry request reference and overdue status, not email/content. Receipt and Apple headers/bodies must be redacted from ingress, APM and request logging. API rate limiting is bounded per process; also configure Cloud Run request/instance limits and appropriate ingress abuse controls.

Manual console work is not inherently required: existing CI/CLI can apply rules, IAM, jobs and secrets once authorised. Some Apple/provider configuration and store-console declarations may require the account owner. Actual project access, accepted policy and deployment references are still required.

## Operator commands and recovery

Build first. The default command is read-only and prints counts, never user records:

```sh
node dist/scripts/accountDeletion.js dry-run
node dist/scripts/accountDeletion.js run --apply
node dist/scripts/accountDeletion.js resolve-task /secure/path/resolution.json --apply
node dist/scripts/accountDeletion.js review-order /secure/path/order-review.json --apply
node dist/scripts/completeClosedCheckout.js /secure/path/verified-checkout.json
```

`resolve-task` input: `requestId`, `taskId`, `resolutionCode`, `reviewer`, `evidenceReference`. The evidence must be a restricted case/reference, not copied personal data. Provider tasks accept `recipient_erasure_confirmed` or `independent_controller_retention_confirmed`; media/ownership tasks accept `asset_erasure_confirmed` or `asset_not_owned_confirmed`; export tasks accept `recipient_erasure_confirmed` or `inventory_verified`. The command refuses an active worker lease and removes temporary contact email/raw target after resolution. It records completion evidence; it does **not** perform the provider's erasure action.

The Resend task `resend-account-review` is created when a request is accepted, with the Authentication email only when present. Legacy profile email aliases and retained order references can create additional restricted Resend tasks. Their reason is `transactional_email_and_label_attachment_review`. Review both recipient addresses and delivered message/attachment copies: a shipping label emailed to a seller can contain the buyer's personal data. Complete the review even if the account has no current email. Use the same provider resolution codes and record evidence for any necessary ongoing retention. Unresolved tasks block completion. The worker does not call a Resend erasure API or claim that delivered mailbox copies have been erased.

Before resolving a provider task, use its documented privacy/processor procedure and independently verify the target. Do not call Stripe customer deletion blindly: it can cancel subscriptions. Do not cancel a Sendcloud parcel as a substitute for erasing personal data. Verify downloaded CSV recipients and backups separately. An independent-controller retention resolution must record the relevant lawful purpose and expiry/review obligation in the referenced case, not merely a generic assertion.

`review-order` input: `orderId`, `completedAt` (ISO date), `reviewer`, `evidenceReference`. For a missing creation date, also supply an independently evidenced `createdAt`; the command cannot overwrite an existing creation date. For cancelled orders, `financialSettlementConfirmed: true` is required only after independently checking that refunds, disputes and payouts are settled. This is an operator attestation, not an automated provider check. It requires an existing delivered/cancelled record with no explicit hold, validates chronological dates and records a verified completion timestamp. It does not cancel an order, resolve a dispute, issue a refund or alter payout state. Existing payment/shipping support must resolve those matters first. The worker reconsiders the hold at its next review.

`completeClosedCheckout` input: `checkoutId`, `reviewer`, `evidenceReference`, and `order` matching the existing order schema (`productId`, `paymentIntentId`, `shipping`, `pickupPoint`). Support must independently verify the requester. It retrieves Stripe's succeeded payment and checks the immutable selection. Without `--apply` it validates only. With `--apply` it records the paid order for existing fulfilment, using the original UID, contact, charged selection and charity allocation. Support evidence and fulfilled state are written in the same transaction, so delayed evidence recording cannot recreate an erased context. It neither charges/refunds the user nor buys a label. A duplicate payment is protected by the existing payment-intent lock. A legacy captured payment without a durable context remains a support reconciliation case, never an automatic cancellation.

Unsettled contexts with an unknown/missing Stripe response require provider-side reconciliation, using the saved checkout reference/idempotency key. Do not mark them cancelled merely because time elapsed. Current main records buyer disputes, including `buyerDisputeStatus=under_review`; the worker treats that state as a hold. It does not resolve disputes or implement a separate payout workflow. Existing support must verify and record the actual resolution.

Set `ACCOUNT_DELETION_WORKER_ENABLED=false` and disable scheduled execution to stop new processing. Let in-flight bounded work finish or stop the job; failed work is resumable. Keep API guards in place and do not restore the legacy deletion method. Set acceptance mode to `disabled` to stop new requests. Disabling a worker does not undo erased data. Recovery copies must remain beyond ordinary use, and deletion decisions must be reapplied in an isolated restore before traffic is exposed. Keep a suppression ledger/recovery process for at least the approved backup horizon even if application audit entries expire earlier.

## Stripe extension review contract

The local adapter captures customer-ID candidates from `customers/{uid}` before Authentication removal and creates the private task `stripe-extension-customer`, kind `stripe_extension_review`. It does not copy checkout secrets or complete financial payloads. Legacy document ownership and both Stripe metadata spellings (`firebaseUID` and `firebaseUid`) require independent verification. A document path or email alone does not establish provider ownership.

Production readiness requires `ACCOUNT_DELETION_READINESS.extensions`. Its restricted evidence must cover the actual extension version, collection path `customers`, disabled automatic Customer deletion, closure controls for all callable/background entry points, and a verified procedure to stop and drain relevant writers. This reference is pinned to each request; changing it stops processing and completed-audit expiry pending review. `Do not delete` alone does not stop extension writers or block its billing portal. The deployed extension remains unchanged. Its 5 October metadata was inspected, but guard-aware entry points, drained writers and financial safety remain unverified. This gate records an operator attestation; it does not automatically re-read remote extension configuration.

Read the current private task, complete its investigation, and put the reviewed input in a restricted local JSON file. The following is a template, not evidence or an approval to run against a live account:

```sh
node dist/scripts/accountDeletion.js resolve-task /secure/path/extension-resolution.json --apply
```

The input must include:

```json
{
  "requestId": "CURRENT_DELETION_REQUEST_UUID",
  "taskId": "stripe-extension-customer",
  "reviewer": "VERIFIED_OPERATOR_IDENTIFIER",
  "evidenceReference": "RESTRICTED_FINANCIAL_AND_OWNERSHIP_CASE",
  "resolutionCode": "customer_tree_erasure_approved",
  "expectedReviewGeneration": "COPY_CURRENT_PRIVATE_TASK_GENERATION",
  "expectedMappingHash": "COPY_CURRENT_PRIVATE_TASK_MAPPING_HASH",
  "expectedConfigurationEvidence": "COPY_CURRENT_PRIVATE_TASK_CONFIGURATION_REFERENCE",
  "customerOwnershipVerified": true,
  "financialEvidencePreserved": true,
  "supportContinuityVerified": true,
  "writersStoppedAndDrained": true,
  "writerEvidenceReference": "RESTRICTED_VERIFIED_DEPLOYMENT_AND_DRAIN_CASE"
}
```

These are evidence-backed operator attestations, not boxes to tick speculatively. Financial evidence must be reconciled or migrated to an approved retention workflow, with continuing support for any existing paid obligations. Generic processor erasure or independent-controller retention acknowledgements cannot approve this local tree erasure. The command refuses an active worker lease. It compares `expectedReviewGeneration` with the task's `reviewGeneration`, `expectedMappingHash` with `mappingHash`, and `expectedConfigurationEvidence` with `configurationEvidence` transactionally. It stores the matching values as `approvedReviewGeneration`, `approvedMappingHash` and `approvedConfigurationEvidence`. The trimmed reviewer value must be at least three characters long; the trimmed `evidenceReference` and `writerEvidenceReference` must each be at least eight characters long. An old approval file cannot approve a new review generation, changed mapping or changed configuration reference.

Once approved, the worker recursively erases the exact UID customer tree, including orphan descendants. It records an attempt before erasure. Interrupted attempts with remaining data, changed/missing mappings, and data recreated after erasure invalidate approval and require a fresh review. Recreated records are preserved for investigation rather than repeatedly deleted. Completed jobs are also checked during their audit period. Before audit expiry, the worker compares the request's pinned `extensionConfigurationEvidence` with the current configuration reference; a mismatch reopens review and prevents removal of the guard/audit. Reappearing data similarly reopens review, clears completion/live-erasure milestones and preserves the guard. The worker does not silently reuse the prior approval.

Mapping hashes do not prove that unchanged-ID descendants are stable. Actual suppression and draining of privileged writers is an external prerequisite, including pending Auth-create events, queued checkout work and webhook calls. Emulator tests verify the adapter's safeguards; they do not execute the deployed extension or prove that its writers are stopped.

## Verification and remaining release gates

Run emulators with a demo project only. Java 21 or later is needed by the installed emulator release:

```sh
npx -y firebase-tools@latest emulators:start --only auth,firestore,storage --config firebase.deletion.json --project demo-cherry-deletion
npm run test:deletion:emulator
npm test -- --runInBand
npm run build
npm run lint:check
```

The test setup pins loopback hosts and the demo project; never change it to a real project. The test suites cover request security, nested cleanup, media isolation, stale-client rules, active orders, payment context, retries, expiry and guarded historical updates. Integration checks also need to cover per-user likes, counter reconciliation and public profiles. See [verification](verification.md) for which runs have actually completed. Provider sandbox calls, real Apple revocation, staging deploy, Flutter/web end-to-end and backup restoration have not been performed.

Follow the [isolated staging plan](cloud-preflight.md#prepared-isolated-staging-plan); no such project is currently authorised. Before production, verify disposable accounts in the named authorised staging project, record database/file/Auth observations, trigger failed/restarted jobs, confirm visibility on a stale second device and direct links, confirm a real status receipt after sign-out, and verify provider acknowledgement plus backup expiry. Approve the final notice and retention schedule, complete frontend/web work and update store declarations. Backend implementation, local verification and production readiness are separate outcomes.


### Interrupted shipment creation

Shipment creation records `shipmentCreationPending`, a random attempt reference and its start time on the order before contacting Sendcloud. Cleanup treats this as an operational hold. Successful parcel persistence and removal of that hold commit together. Repeated requests cannot start another parcel while the outcome is uncertain. This also protects accounts closed after a payment succeeded.

A provider timeout or a crash leaves the hold in place. Support must verify the Sendcloud outcome using the order reference, reconcile any existing parcel and preserve the necessary evidence before an authorised operator clears the hold. Never clear it because a timeout elapsed, and never retry the provider call blindly. Include these holds in the review queue and alert on overdue cases. This implementation does not automatically cancel parcels, create refunds or release uncertain shipment holds.
