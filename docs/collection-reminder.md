# Collection reminder integration

This change extends confirmation PR #74 and supplies the collection pop-up in frontend PR #573:

- https://github.com/Cherry-CIC/cherry-Backend/pull/74
- https://github.com/Cherry-CIC/MVP/pull/573

## Deadline contract

For pickup-point orders with the canonical `inpost_gb` carrier, an accepted Sendcloud `Awaiting customer pickup` event stores `readyForCollectionAt` from `carrier_status_change_timestamp` and `collectionDeadline` as that instant plus 72 elapsed hours. Both fields are written transactionally with shipment and order status.

This is the product owner's agreed flat 72-hour MVP rule. It is not an authoritative per-parcel deadline supplied by Sendcloud. InPost documents an exception for grouped parcels, so this approximation can end earlier than the carrier's actual window. See https://inpost.co.uk/help/how-long-do-i-have-to-pick-up-my-parcel.

Sendcloud `timestamp` alone orders status changes. The carrier timestamp never replaces it. Events without a usable ordering timestamp do not change tracking state. Missing carrier arrival time leaves the deadline absent. A retry with carrier evidence can fill the missing time, or shorten it to an earlier recorded arrival, without extending it. Historical `lockerDeliveredAt` values are not reused.

Duplicate ordering timestamps do not reapply status. A tied conflicting status cannot supply new arrival or collection evidence. Older arrival evidence can shorten a window only while the stored shipment is still awaiting collection. Older collection evidence can recover the inspection start without rolling back the latest status, preserving PR #74's behaviour.

Collection, cancellation and return states cannot regress into awaiting collection. Generic delivered or transit updates do not replace an active awaiting-collection status; customer collection remains a distinct event. Return-to-sender statuses are exposed separately from other exceptions. Corrections that would reopen a terminal shipment require a future explicit operational recovery path.

## Buyer API

Order responses include:

| Field | Meaning |
| --- | --- |
| `readyForCollectionAt` | UTC ISO arrival instant, or null |
| `collectionDeadline` | UTC ISO persisted deadline while awaiting collection, otherwise null |
| `collectionPoint` | Saved locker selection, including name, street, city, postcode and country, or null |
| `trackingUrl` | Existing shipment tracking URL |
| `collectedAt` | Existing recorded customer collection instant |
| `confirmationDeadline` | Existing collection instant plus 48 hours |

An expired collection deadline stays visible while the courier still reports awaiting collection. The app can then show a neutral expiry message. Time alone does not mark a parcel returned, collected, confirmed or refunded.

Existing orders without new arrival evidence have no collection countdown. No migration or automatic fallback to request time is included. After customer collection the collection deadline is suppressed from the active API state, while stored arrival evidence remains available for audit.

## Verification

TypeScript build and all 520 backend tests in 49 suites pass. Tests cover timestamp separation, 72-hour persistence, retries, missing timestamps, tied and older events, terminal-state protection, carrier and delivery-type restrictions, API output, existing 48-hour confirmation behaviour, notification queue leases and receipts, device ownership, stale-device pruning and authenticated dispatch. Transaction tests use doubles; Firestore rules are separately exercised against the emulator in the frontend PR.

Run locally after installing the lockfile dependencies:

```sh
npm ci
npm run build
STRIPE_SECRET_KEY=sk_test_local_placeholder SENDCLOUD_MODE=mock npm test -- --runInBand
```

The Stripe value is an inert test placeholder. Tests mock external dependencies; no real shipments or payments were created. Read-only Firebase metadata checks confirmed that the existing development default database is Standard edition in europe-west2. No database, rules or deployment configuration was changed.

Live InPost payloads, live map/tracking navigation and physical-device verification remain outstanding. The companion frontend includes the collection Home countdown and notification handling. Automatic confirmation/refund enforcement remains separate work. The pre-existing delivered-email send/mark flow is not a push deduplication mechanism and is outside this change.

## Collection push notifications

`COLLECTION_PUSH_ENABLED` defaults to disabled. When enabled, the accepted arrival transaction creates one `collectionPushJobs` record per shipment, using a SHA-256 shipment identifier. Courier retries and out-of-order updates cannot create another job. No historical backfill is included. Missing carrier arrival evidence does not invent a countdown; the notification can still direct the buyer to the app.

The authenticated device API is:

| Endpoint | Request | Behaviour |
| --- | --- | --- |
| `POST /api/notifications/devices` | `{ "token": "…", "platform": "ios" }` or `android` | Register or refresh the token for the verified buyer. Returns 503 while the feature is disabled. |
| `DELETE /api/notifications/devices` | `{ "token": "…" }` | Idempotent removal only if the token still belongs to the verified buyer. Available while sending is disabled. |
| `POST /api/notifications/dispatch-collection` | Optional `{ "limit": 20 }`, from 1 to 100 | Requires a verified administrator claim. Processes one bounded batch. |

Tokens must contain 1 to 4096 printable ASCII characters without spaces. Tokens are never echoed or logged by these endpoints. `pushDevices/{sha256(token)}` has one current owner, a mobile platform and an update timestamp. Registration is limited to 20 devices per buyer; a currently registered device can still refresh at the limit. Sending ignores registrations older than 90 days, and registration prunes those stale records before enforcing the limit for a new device. Account changes replace token ownership; a delayed old-account logout cannot delete the new owner's registration.

The worker checks current order and shipment state, buyer ownership, payment, collection and deadline eligibility before sending. It takes a transactional lease and records successful devices. Retries skip recorded successes and delete invalid tokens only if ownership still matches. Payloads contain a generic title/body and `type`, `orderId`, `userId`, `eventId` for authenticated app routing. Android notification tags and APNs collapse identifiers are stable per shipment. Notifications expire promptly instead of being delivered indefinitely after readiness.

FCM delivery is not exactly once. A process failure after FCM accepts a message but before the receipt is stored can cause a retry. Stable collapse identifiers reduce duplicate queued or visible notifications but cannot guarantee that a buyer never sees a repeated alert. A collection or account change in the short interval between the final check and provider acceptance can also leave a stale generic alert. The app must always refresh order state before opening the corresponding reminder.

Queue retention is 24 hours, separate from the buyer's collection window. Jobs have bounded retries, and jobs that expire or become ineligible stop sending. Completed jobs retain their deduplication identity. Do not remove them while courier retries for that shipment are possible. Registering a new device after a job completes does not replay that notification; the core in-app reminder remains available.

## Rollout gates and worker operation

No merge, deployment, real push or database mutation is performed as part of these PRs. Keep `COLLECTION_PUSH_ENABLED` off until all of the following have been reviewed and explicitly authorised:

1. Merge the confirmation prerequisites, then retarget and review the collection PRs together.
2. Review and deploy the frontend's Firestore rules to the correct Firebase project. The checked-in legacy rules currently allow public access to orders and shipments. Protecting only the new push collections is insufficient: forged existing order or shipment data could still influence notification eligibility. Resolve that wider access issue before enabling push. See the frontend security audit.
3. Configure and verify FCM, the Apple APNs key, application identifier, push entitlement and signing profiles. Check physical iOS and Android devices, including permission denial, foreground, background, terminated launch, logout and account switching.
4. Deploy the backend with the feature still disabled. Build with `npm run build`. Provision an authenticated scheduled worker using `npm run notifications:dispatch` with the same project credentials as the API. The script processes one batch and exits; it does not install or create a scheduler. A one-minute schedule is the suggested starting point, with capacity and retry monitoring before launch. The administrator-only endpoint is an alternative manual dispatch route, not a public scheduler hook.
5. Enable the flag in both the API and worker only after the checks pass. Future accepted arrival events then queue notifications. Validate a real InPost arrival, its two timestamps, collection transition and the separate inspection deadline.

Stopping the flag stops creation, registration and sending. Device cleanup and core in-app reminders remain available. No automated refund, return or receipt confirmation is triggered by a timer or notification.
