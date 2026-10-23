# Order hold and release

Paid orders keep their funds `held` until the buyer has had a chance to confirm
delivery or raise a dispute. `payoutStatus` tracks this and is separate from the
fulfilment `status`.

```
paid  ->  payoutStatus: held  ->  payoutStatus: ready_for_payout
```

Paying the charity is a separate step (issue #44) that starts from
`ready_for_payout`.

## Rules

- The hold starts at the **first** carrier `delivered` report (`deliveredAt`).
  Repeated webhooks never extend it.
- `releaseAt = deliveredAt + ORDER_HOLD_PERIOD_HOURS` (default 48).
- An order is released when **either** the buyer confirms receipt **or** the hold
  expires, and only if nothing blocks it.
- Blocked when: the payment is not confirmed or is `flagged`, a dispute is open,
  or any hold reason is active (`dispute`, `refund`, `chargeback`, `fraud`, `admin`).
  Holds are tracked as a set (`payoutHoldReasons`) and the order is released only
  once the set is empty.
- A buyer cannot raise a dispute after confirming receipt, after release, or at or
  after `releaseAt`, even if the release task has not run yet.
- A buyer cannot confirm receipt while a dispute exists.

## Where it happens

| Step | Code |
|---|---|
| `paid` -> `held` | `OrderRepository.finalizePendingOrder` |
| Delivery starts the hold and schedules the release task | `OrderReleaseService.startHoldOnDelivery` (called by the Sendcloud webhook) |
| Buyer confirmation releases | `confirmOrderReceived` |
| Hold expiry releases | `POST /api/internal/order-release/tasks` (Cloud Tasks) |
| Dispute raised -> hold reason `dispute` | `DisputeRepository.createBuyerDispute` |
| Dispute resolved | `DisputeRepository.moderateDispute` with an `outcome` |
| The release decision itself | `OrderRepository.releaseOrderForPayout` / `evaluatePayoutRelease` |

All release paths use the same checks inside one Firestore transaction, so a
dispute that lands first always wins.

## Release task (Cloud Tasks)

When the carrier reports delivery, one Cloud Task per order is created with the
deterministic name `order-release-<orderId>` and `scheduleTime = releaseAt`, so
scheduling is idempotent. The task carries an OIDC token. `POST
/api/internal/order-release/tasks` verifies the audience and that the token's
verified email is the configured service account, then releases the order with the
same transactional checks as every other path. Buyer confirmation still releases
immediately; the task then finds the order released and does nothing.

The worker returns 200 for any final outcome (released, already released, blocked)
and 5xx when the order is not yet due or on an unexpected error, so Cloud Tasks
retries only when it should. A blocked order is released later by buyer
confirmation, the dispute resolution, or the reconciliation run.

The queue, audience and service account provisioned for fulfilment (PR #64) are
reused:

| Setting | Falls back to |
|---|---|
| `ORDER_RELEASE_TASKS_QUEUE` | `CLOUD_TASKS_QUEUE` |
| `ORDER_RELEASE_WORKER_AUDIENCE` | `FULFILLMENT_WORKER_AUDIENCE` |
| `ORDER_RELEASE_WORKER_SERVICE_ACCOUNT` | `FULFILLMENT_WORKER_SERVICE_ACCOUNT` |

`ORDER_RELEASE_WORKER_URL` has no fallback and must point at
`/api/internal/order-release/tasks` on the deployed service. `CLOUD_TASKS_PROJECT_ID`
(or `FIREBASE_PROJECT_ID`) and `CLOUD_TASKS_LOCATION` are shared too.

If scheduling fails, the order stays held and the failure is logged. A repeated
delivery report, or the reconciliation run below, schedules it again.

## Reconciliation

`OrderReleaseReconciliationService` is the safety net for the task path. It releases
orders that are past their release time with no hold or dispute (a lost task, or a
hold lifted after the task ran) and schedules a task for held orders that never got
one.

- `POST /api/admin/payouts/reconcile` (admin token), optional `{ "limit": 1-1000 }`.
- `POST /api/internal/order-release/reconcile` (the same Cloud Tasks identity and
  OIDC check as the worker), for a periodic run such as Cloud Scheduler every 15
  minutes.

Both read only orders that have `autoReleaseAt` set. That field equals `releaseAt`
while nothing blocks the order. It is removed when a hold or dispute is placed, when
the order is released, and when a run finds the order blocked for a reason it cannot
wait out (for example a flagged payment). It is restored when a hold is cleared. So
orders that stay blocked for a long time are never rescanned and cannot crowd out
newer overdue orders. A run scans at most `limit` orders (default 200), oldest
first, and returns `scanned`, `released`, `alreadyReleased`, `blocked`,
`tasksScheduled` and `errors`. Repeating it, or running it alongside a task, is
harmless.

### Firestore

No composite index is needed: the run queries `autoReleaseAt` (single field) and the
history is ordered by `createdAt` (single field), both indexed automatically.

## Dispute resolution outcome

Resolving a dispute requires `outcome` on
`PATCH /api/admin/disputes/{disputeId}/status`:

- `release_to_charity` - lifts only the `dispute` hold and moves the order to
  `ready_for_payout` (still refused for a flagged or unconfirmed payment, or while
  a `refund`, `chargeback`, `fraud` or `admin` hold is active).
- `refund_buyer` - ends the `dispute` hold and adds a `refund` hold, keeping the
  funds held. Other active holds are kept. Executing the refund is not part of
  this change.

## Stripe events

The webhook endpoint (`/api/payment/webhook`) must be subscribed to these events in
addition to `payment_intent.succeeded` and `payment_intent.canceled`:

| Event | Effect |
|---|---|
| `charge.refunded` | hold reason `refund` |
| `charge.dispute.created` | hold reason `chargeback` |
| `radar.early_fraud_warning.created` | hold reason `fraud` |
| `charge.dispute.closed` | `won` clears the `chargeback` hold and retries the release; any other outcome keeps it |

Until the endpoint is subscribed, none of these arrive. Use the script, which adds
only the missing events and keeps the existing subscription. It acts on the account
`STRIPE_SECRET_KEY` belongs to and prints whether that is test or live:

```
npm run stripe:webhook:events -- --url https://<your-service-url>/api/payment/webhook          # dry run
npm run stripe:webhook:events -- --url https://<your-service-url>/api/payment/webhook --apply
```

The order is found through the PaymentIntent. If it was already `ready_for_payout`
but not yet paid out, it goes back to `held`, so the payout step never sees a
refunded or disputed order. Each hold is tracked separately in
`payoutHoldReasons`; clearing one (for example a won chargeback) never lifts the
others, and the order is retried for release only once none remain.
`payoutHoldReason` mirrors the first active reason for display. Every hold is
recorded in the history. Replayed events change nothing. Failures return 500 so
Stripe retries.

## Admin controls

All require an admin token and a `note` (max 2000 characters) for the audit trail.

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/orders/{orderId}/payout` | Payout state, timing and event history |
| `POST /api/admin/orders/{orderId}/payout/hold` | Place an `admin` hold (a ready order returns to held) |
| `POST /api/admin/orders/{orderId}/payout/unhold` | Remove an `admin` hold only, then release if past `releaseAt` |
| `POST /api/admin/orders/{orderId}/payout/release` | Override: skips the hold period and refund, chargeback, fraud and admin holds |

The override never skips an unresolved buyer dispute (resolve it through the
dispute endpoint), an unconfirmed or flagged payment, or an order that was not
delivered. The order CSV export gains `Payout Status`, `Payout Hold Reason`,
`Delivered At` and `Release At` columns at the end.

## History

Every state change writes an append-only event to `orders/{orderId}/payout_events`
in the same transaction: `hold_started`, `hold_placed`, `hold_cleared` and
`released`, with the actor (`system`, `buyer`, `admin`, `stripe`), trigger or
reason, note and Stripe event ID where relevant. Blocked or repeated releases
write nothing.

## Orders delivered before this change

Orders paid before this change have no `payoutStatus`. If they are delivered
afterwards they start a hold on delivery. Orders already delivered need a one-off
backfill before the payout step (#44) is switched on:

```
npm run payout:backfill                  # dry run: prints each order that would change
npm run payout:backfill -- --apply       # write the holds
npm run payout:backfill -- --limit 500   # scan at most 500 paid orders
```

For each paid, delivered order with no `payoutStatus` it applies the hold an order
delivered today would get:

- `deliveredAt` comes from the best time still known: the order, the delivered
  shipment's last update, the buyer's confirmation, the order's last update, then
  the payment time. The audit event says which one was used, so treat the hold
  window as approximate.
- If the buyer already confirmed, the hold ends at the confirmation.
- A past window is released by the next reconciliation run, after the usual checks (so
  flagged payments still stay put).
- Any order with a dispute is put on a `dispute` hold with no automatic release,
  because the old dispute flow recorded no outcome. Resolve those through the
  dispute endpoint, or release them with the admin override.
- Unpaid, refunded and not-yet-delivered orders are left alone.

It is safe to repeat: an order that already has a `payoutStatus` is skipped, both
when planning and inside the write transaction.

## Fulfilment worker

PR #64's Cloud Tasks fulfilment worker is restored (`POST
/api/internal/fulfillment/tasks`, `FulfillmentTaskQueue`, `FulfillmentTaskAuth`).
Checkout still fulfils directly. When that does not finish and no other worker
holds the job, a recovery task is enqueued (best effort; failures are logged). It
uses `CLOUD_TASKS_*`, `FULFILLMENT_WORKER_URL`, `FULFILLMENT_WORKER_AUDIENCE` and
`FULFILLMENT_WORKER_SERVICE_ACCOUNT`.

## Buyer email

The delivered email states when the confirm-or-dispute window ends (UK time) and
that confirming sends the donation on to the charity.
