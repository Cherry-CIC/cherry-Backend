# Account deletion verification

Report updated: 8 October 2026. The implementation is integrated on `codex/account-deletion` from GitHub main `eedbbb6`. No staging or production data was changed.

## Integrated checkout results: 8 October 2026

These checks ran against `codex/account-deletion`, based on GitHub main `eedbbb6`. A final fetch confirmed that main still points to this commit.

| Check | Result |
| --- | --- |
| `npm run build` | Passed: strict TypeScript compilation |
| `npm run lint:check` | Passed: non-mutating ESLint check |
| `npm test -- --runInBand` | Passed: 24 suites, 289 tests |
| `npm run test:deletion:emulator` | Passed: 6 suites, 37 tests; exit 0 |
| OpenAPI generation | Passed: all three deletion paths, `DeletionResponse`, 202 acceptance contract and existing user routes present |
| `git diff --check` | Passed |
| `npm audit --omit=dev` | 12 advisories: 4 high, 8 moderate, 0 critical; see dependency findings |
| Staging/provider/frontend validation | Not run; still requires the documented access, configuration and approvals |

Main already contained synchronous account deletion, per-user likes, public profiles, order emails and signed Sendcloud webhook verification. Integration preserves these existing features while replacing synchronous deletion with durable processing. New coverage verifies guarded profile and like access, paginated likes cleanup with no double decrement, conflicting profile ownership, buyer disputes, and in-flight shipment protection. Resend recipient review now blocks completion, including when a cleanup adapter reports success. Existing receipt fixtures were updated to acknowledge this requirement explicitly.

The emulator run used Authentication, Firestore Standard and Storage locally with project `demo-cherry-deletion`, Firebase CLI 15.33.0 and a checksum-verified Temurin Java 21 runtime. It printed Jest's one-second shutdown notice, then exited 0. No deployed provider service or real account was exercised. Apple transport remains mocked.

## Historical archive results: 6 October 2026

These results apply to the supplied backend archive before integration with current main. Scope: local backend, isolated Firebase emulators and read-only remote project/database/extension/function/index metadata.

| Check | Result |
| --- | --- |
| `npm run build` | Passed: strict TypeScript compilation |
| `npm test -- --runInBand` | Passed: 8 suites, 29 tests |
| `npm run lint:check` | Passed: non-mutating ESLint check |
| `npm run test:deletion:emulator` | Passed: 6 suites, 33 tests against local Authentication, Firestore Standard and Storage emulators; process exited 0 |
| Swagger/OpenAPI generation | Passed: all three deletion paths and `DeletionResponse` present; fixed an existing duplicate YAML description that had prevented complete generation |
| Production dependency audit | 12 inherited/transitive advisories: 4 high, 8 moderate, 0 critical. Recorded below; no broad SDK upgrade performed |
| Read-only remote metadata inspection | Passed after sign-in refresh on 5 October: only `cherry-mvp` visible; `(default)` Standard Native database in `europe-west2`, PITR disabled; extension/function and index metadata inspected |
| Subsequent remote access check | Blocked on 6 October: Firebase CLI credentials had become invalid again. The successful 5 October metadata findings remain historical evidence, not a fresh access or configuration check |
| Disposable staging test and deployed rules/runtime verification | Not run: no separate authorised staging project identified; refreshed credentials and remaining configuration checks are required. Successful metadata access does not establish staging or deployment readiness |
| Stripe/Sendcloud sandbox and real Apple revocation | Not run: no authorised provider configuration supplied; Apple transport mocked and identity binding tested |
| Flutter/web end-to-end, accessibility and store declarations | Not run: handover only, frontend unchanged |

The 6 October archive emulator run printed Jest's transient one-second shutdown notice, then exited successfully with code 0. This notice is recorded rather than treated as proof of a persistent open handle. No deployed extension or provider service was exercised by these tests.

The original Jest configuration excludes `src/modules/order/tests/exportRoutes.test.ts` and `src/modules/products/tests/productRoutes.test.ts`. They remain excluded; the passing count is not a claim that every existing test file ran. The new emulator files are explicitly excluded from ordinary unit tests and run by their own configuration.

The baseline unit run failed because the shipping controller test imported real Firebase credentials through an unmocked user repository. That test now mocks its unused repository dependency. Payment and order tests were adapted for durable checkout context and the server-only paid-product lookup. Production Firebase was not contacted to make unit tests pass.

## Regression scenarios

The integrated emulator suite repeats the archive scenarios below and adds the cases described above.

- Request and guard are persisted together; repeated requests with the same secret recover the same reference; another secret cannot take over the receipt.
- API rejects a legacy client contract, caller-supplied target UID and reference-only status access; responses exclude contact details and disable caching.
- Public product list/detail reads suppress closed owners; new checkout context is rejected after closure.
- Private cross-user profiles, privileged profile fields, direct writes to guards/evidence, another user's uploads and ambiguous first-name upload paths are denied by prototype rules.
- A stale client cannot recreate a profile, save an address or upload new owned media after its guard exists.
- 510 nested descendants under a missing intermediate document are removed, including orphan subcollections; another account is preserved.
- Owned product variants are deleted while other UID prefixes survive. Repeated sweeping also removes a late completed upload without affecting another owner.
- Authentication can be removed before a later cleanup failure. Retry continues from durable state without signing in; a second worker cannot claim an active lease.
- Active seller orders retain fulfilment data while unrelated profile/listing data disappears. Legacy seller identity is discovered through product relationships.
- Started checkout context survives closure; duplicate/out-of-order provider state recording does not regress a succeeded checkout or cancel money.
- Terminal data is minimised; private evidence excludes email, addresses and photos. Financial/evidence expiry is separate from live-data erasure.
- Expiry removes both private records and corresponding live order identifiers/amounts, shipment trees and idempotency locks. Only the remaining counterparty UID and order state survive in a minimal shell; their later account closure removes it. Historical repository updates cannot repopulate erased data.
- New Firebase UID using the old email cannot obtain historical orders. Stripe Customer reuse now additionally requires matching UID metadata.
- Apple code exchange rejects another linked identity; refresh tokens are encrypted and sent only to Apple's revocation endpoint in mocked tests.
- A saved receipt secret recovers a lost acceptance response after Authentication removal. A minimal receipt survives earlier private audit expiry without a UID and expires on its advertised date.
- Both participants closing their accounts receive the same verified terminal checkout outcome; one job cannot strand the other's hold by deleting shared context.
- Missing order dates remain operational holds even if a review task is marked resolved. Parcel cancellation alone does not establish financial settlement.
- Pending seller listings keep only necessary fulfilment fields; ambiguous media is still discovered. A seller request does not create an erasure task for the buyer's Stripe Customer.
- Price, quantity, postage and charity changes, and listing deletion, cannot race an unresolved checkout. Original allocation/selection and support evidence are consumed atomically during paid completion.
- A later financial/legal hold suspends expiry. Releasing it preserves the existing retention schedule.
- Disabled/missing policy, invalid dates, non-demo emulator targets and missing production readiness fail closed. A changed period cannot silently reuse a pinned policy version.
- Stripe extension customer-ID candidates are captured before Authentication removal without copying checkout secrets or full provider payloads. A generic provider acknowledgement cannot approve local customer-tree erasure.
- Reviewed extension cleanup removes more than 450 orphan descendants while preserving another owner. Changed or missing mappings reject stale approval files; interrupted erasure requires a new review before retry.
- Extension data recreated after completion reopens review and preserves the new data and account guard. Changed deployment evidence blocks processing and completed-audit expiry.

Emulators do not prove deployed IAM, indexes, extension behaviour, resumable-session expiry, public download token invalidation, all-version object erasure, provider erasure, backup retention or restore safety. These require the runbook's staging checks.

## Historical dependency findings

The 6 October archive `npm audit --omit=dev` run reported high advisories through Firebase 11.10's pinned `@grpc/grpc-js` 1.9.16, including GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4. The Admin SDK's Firestore dependency resolves a newer gRPC version. Moderate advisories also pass through older `uuid` in Google SDK dependencies (GHSA-w5hq-g745-h8pq). These dependencies predate the deletion feature; the new lockfile makes the resolved tree reproducible. Assess applicability and a supported SDK upgrade before production rollout. Do not run `npm audit fix --force` blindly: the suggested changes include incompatible Firebase major-version changes.

## Files and reproducibility

The current integration baseline is GitHub main `eedbbb6` on branch `codex/account-deletion`. The original archive snapshot remains `/tmp/cherry-deletion-baseline/backend-before.tgz`. See [the changed-file inventory](changed-files.md), generated from the integrated branch diff. No production release was created. See the [PR description draft](pull-request.md); the draft does not establish that a PR has been published.

The implementation adds a lockfile and a compatible flat ESLint configuration because the supplied ESLint 9 setup had only legacy configuration and lacked its referenced TypeScript parser. `lint:check` does not apply fixes. No external Firebase configuration was changed.
