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

TypeScript build and all 428 backend tests pass. Tests cover timestamp separation, 72-hour persistence, retries, missing timestamps, tied and older events, terminal-state protection, carrier and delivery-type restrictions, API output and existing 48-hour confirmation behaviour.

Run locally after installing the lockfile dependencies:

```sh
npm ci
npm run build
STRIPE_SECRET_KEY=sk_test_local_placeholder SENDCLOUD_MODE=mock npm test -- --runInBand
```

The Stripe value is an inert test placeholder. Tests mock external dependencies; no real shipments or payments were created. Read-only Firebase metadata checks confirmed that the existing development default database is Standard edition in europe-west2. No database, rules or deployment configuration was changed.

Live InPost payloads, live map/tracking navigation and physical-device verification remain outstanding. Push notifications, collection Home countdown and automatic confirmation/refund enforcement remain separate work. The pre-existing delivered-email send/mark flow is not a push deduplication mechanism and is outside this change.
