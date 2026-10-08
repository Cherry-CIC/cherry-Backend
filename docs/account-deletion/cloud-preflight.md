# Read-only cloud preflight and isolated staging plan

Remote findings recorded on 6 October 2026; source reconciliation updated on 8 October. Firebase CLI sign-in was refreshed on 5 October. The subsequent investigation read project, database, index, extension and function metadata. It did not read user documents, payment records or uploaded objects, reveal secret values, change remote configuration or run account deletion. This is a configuration inventory, not staging verification. A further check on 6 October found the CLI credentials invalid again. The metadata below is historical evidence; it has not been refreshed during repository integration.

## Confirmed metadata and its limits

| Item | Read-only finding | What it establishes |
| --- | --- | --- |
| Accessible Firebase project | `cherry-mvp`, project number `401854471349` | This is the only project visible to the current CLI account. It does not prove that no other projects exist or that this project is authorised for staging |
| Supplied backend URL | `https://cherry-backend-401854471349.europe-west2.run.app` | Its project number matches `cherry-mvp`. Treat the project as the current app environment until its owner establishes otherwise |
| Database | `(default)`, Standard edition, Firestore Native, `europe-west2` | Existing native Admin SDK operations use the expected database type. This does not verify deployed code or rules |
| Database recovery metadata | PITR disabled; `versionRetentionPeriod` is `3600s` | The reported database version window is one hour. This says nothing about scheduled backups, exports, Storage versions, soft deletion or downloaded copies |
| Extension | `stripe/firestore-stripe-payments`, version `0.3.4` | A second Stripe data path exists independently of the Express backend |
| Extension parameters | `DELETE_STRIPE_CUSTOMERS=Do not delete`; `SYNC_USERS_ON_CREATE=Sync`; `CUSTOMERS_COLLECTION=customers`; `PRODUCTS_COLLECTION=products` | Interpret using the exact source below. A parameter is not evidence that historical customer data has been erased |
| Extension functions | `createCustomer`, `createCheckoutSession`, `createPortalLink`, `handleWebhookEvents`, `onUserDeleted`, `onCustomerDataDeleted` | Authentication and Firestore events can invoke provider-integrated functions outside the backend worker |
| Observed index metadata | `product_listing`: `category + createdAt`; `products`: `userId + createdAt`; `user_likes`: `userId + createdAt` | Current main establishes `products` and `user_likes` schemas. `product_listing` remains unresolved. An index alone does not prove a collection contains documents or matches the deployed application schema |

Deployed Firestore/Storage rule contents, runtime identities/IAM, Storage bucket configuration, scheduled backups, export destinations, logging retention, active deployment revision and provider test/live mode remain unverified by this record. Successful Firebase CLI sign-in does not establish Application Default Credentials or Cloud Run deployment access.

## Stripe extension 0.3.4 source findings

The official release commit is [`107031923116d776ace0d33011a28d29e48fe827`](https://github.com/invertase/stripe-firebase-extensions/commit/107031923116d776ace0d33011a28d29e48fe827). Its [manifest](https://github.com/invertase/stripe-firebase-extensions/blob/107031923116d776ace0d33011a28d29e48fe827/firestore-stripe-payments/extension.yaml#L15-L17) declares `version: 0.3.4`. Conclusions below use that release, not the repository's current branch. This is published-source verification; the deployed function bundles have not been compared byte-for-byte.

The configuration enables `autoDeleteUsers` only for the exact value `Auto delete`. It enables signup synchronisation only for `Sync`. With the observed `Do not delete`, automatic provider deletion is disabled. [Versioned configuration](https://github.com/invertase/stripe-firebase-extensions/blob/107031923116d776ace0d33011a28d29e48fe827/firestore-stripe-payments/functions/src/config.ts#L17-L27)

Both deletion handlers return immediately when `autoDeleteUsers` is false. Consequently, the observed setting means neither Authentication deletion nor `customers/{uid}` deletion invokes Stripe Customer deletion through these handlers. Neither handler recursively erases Firestore. If enabled later, both can call Customer deletion, cancelling subscriptions. Signup synchronisation creates a Customer and mapping with metadata key `firebaseUID`. Other callbacks write checkout sessions, payments, subscriptions and invoices and do not consult cherry's deletion guard. Existing mappings can therefore permit later callback writes after Authentication removal. [Versioned handlers and helpers](https://github.com/invertase/stripe-firebase-extensions/blob/107031923116d776ace0d33011a28d29e48fe827/firestore-stripe-payments/functions/src/index.ts#L857-L919)

The extension's installation guidance identifies separate Firestore cleanup and demonstrates per-user payment paths. Inventory the entire `customers/{uid}` tree, including `checkout_sessions`, `payments`, `subscriptions` and nested `subscriptions/{subscriptionId}/invoices`. These are additional copies, not merely a Stripe provider reference. Do not copy complete payment/checkout documents into deletion logs or retained evidence: they may contain billing details and client credentials. [Versioned installation guidance](https://raw.githubusercontent.com/invertase/stripe-firebase-extensions/107031923116d776ace0d33011a28d29e48fe827/firestore-stripe-payments/POSTINSTALL.md)

The extension's `firebaseUID` metadata spelling differs from this backend's `firebaseUid`. Therefore an account may have more than one provider Customer. This is an inference from the two creation paths, not an observation of a real account. Provider discovery must use verified UID ownership and stored customer references, never email alone. Shared `products` catalogue entries and their prices are not automatically owned by the closing user.

## Required local integration and release evidence

The following requirements apply to the conservative extension adapter and its eventual rollout:

- Capture only the verified customer reference and a private review task before any tree cleanup. Enumerate descendants, including those below a missing parent, without assuming subscriptions or invoices are empty.
- Do not let unreviewed extension data count as erased. Reconcile active subscriptions, pending sessions, payments, invoices and provider obligations first. Move only specifically justified evidence into the approved restricted retention model.
- Prove that automatic Stripe deletion remains disabled before deleting either Authentication or the customer document. A local configuration declaration is an attestation that needs current remote evidence. Changing the extension's deletion mode invalidates that evidence.
- Block new direct extension checkout writes from closed accounts. The existing prototype denies unlisted collections; integrate this explicitly when merging rules. Server functions bypass those rules, so queued writes and webhook replay need a tested reconciliation and repeat-sweep procedure.
- Ensure the supported extension callbacks cannot silently recreate personal data after completion. Test delayed signup synchronisation, checkout callbacks and provider events. A successful one-off recursive delete is insufficient evidence.
- Keep recipient erasure and Firestore erasure separate. The observed setting prevents automatic Customer deletion; it does not satisfy Stripe privacy obligations on its own.

The exact implemented adapter flags, review codes and tests belong in [the deployment runbook](firebase-deployment.md). The requirements above do not claim that an extension sandbox or deployed trigger has been exercised.

## Source and deployment reconciliation

The original supplied backend archive lacked the frontend's liked-item endpoints. GitHub main `eedbbb6` contains those endpoints and `ProductLikeRepository`, which stores `user_likes` records with `userId`, `productId` and `createdAt`. The current branch integrates this real schema with guarded like operations, resumable relationship cleanup and counter reconciliation. Public profiles also honour account restrictions. The archive's missing likes implementation is no longer an unresolved source finding.

Current main also contains signed Sendcloud webhook verification, buyer dispute state and Resend transactional emails with label attachments. Its delivery status updates do not themselves establish the verified dates or financial settlement needed to release retention holds. Disputes under review retain a scoped hold; email and attachment copies need recipient/provider review.

The integration now has an identified Git baseline, but the repository commit and built image serving the app remain unverified. `product_listing` is still known only from index metadata. Before release, trace its writers, readers and ownership, confirm which paths are actually deployed, and add an adapter if needed. Verify direct Firebase and API access together; do not guess fields from collection names.

## Prepared isolated staging plan

No staging project has been identified or authorised, and none was created. Do not relabel `cherry-mvp` as staging or create disposable accounts there merely because it is accessible.

1. Have the owner identify a separate existing non-production project, or approve a separately scoped creation plan including cost and access. Record its project ID, database, bucket, region and responsible owner. No creation command has been run.
2. Inspect that project's rules, indexes, extension version/parameters, trigger resources, service accounts, backups and bucket lifecycle through metadata reads. Check that Firebase, Storage, Stripe and Sendcloud configuration cannot reach current-app resources. Read secret references and mode metadata, not secret values in logs.
3. Use synthetic fixtures only. Do not clone production user data. Keep deletion acceptance and workers disabled until the reviewed configuration is applied in the explicitly authorised staging project. Use Stripe test resources, mocked Sendcloud unless its sandbox is separately authorised, and an approved Apple test journey.
4. Merge restrictive rules against the complete app schema. Deploy the identified review artifact and required indexes through the existing process only after staging authorisation. Confirm index readiness and extension safety before creating test accounts, since signup synchronisation itself can create Stripe Customers.
5. Run the disposable-account scenarios in [verification.md](verification.md) plus extension customer-tree cleanup, delayed callbacks, separate Customer ownership and legacy collection coverage. Observe Authentication, Firestore, Storage and provider results. Test failure/restart, status after sign-out, re-registration, stale devices and public download URLs.
6. Verify recovery-copy expiry and an isolated restore that reapplies deletion decisions before exposing data. Record evidence for each production readiness reference. A passed emulator suite is not a substitute for this step.

Production remains blocked on approved retention/privacy wording, reconciled source and data inventory, compatible reviewed/deployed rules, verified extension handling, staging evidence, provider procedures, scheduling/alerts and the complete frontend/web journey. Erased data cannot be restored as an ordinary rollback.
