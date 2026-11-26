# Buyer locker collection push

The signed Sendcloud parcel status webhook sends an alert on **Awaiting customer pickup** for a paid UK InPost locker order. The push tells the buyer to use the collection code in their InPost email. The existing delivered email and receipt confirmation flow continue to use the delivery event.

## App integration

- After the buyer grants permission, register their FCM token with `POST /api/notifications/devices` using their Firebase bearer token and a JSON body containing `token` and `platform` (`android` or `ios`). Register on sign-in, token change and periodically on app use. Registrations expire for sending after 90 days.
- On opt-out or before sign-out, send `DELETE /api/notifications/devices` with the same bearer token and a body containing `token`. A later sign-in can transfer a token to the new owner.
- On tap, handle `notificationType=locker_ready`, `entityType=order`, `entityId=<order ID>` and `notificationId`. Fetch the current order with the signed-in user's credentials. The message contains no collection code.

## Delivery behaviour

The webhook checks the chosen service point, UK carrier and delivery method. Existing service point records lack a structured locker type. A locker name or a shipping method identifying a locker destination supplies that evidence. An ambiguous point is skipped. If Sendcloud supplies a destination point ID, it must match the order's selected point.

Each shipment has a stable notification ID. The backend records the eligible devices on the first dispatch, checks the order and device ownership again before sending, and records successful sends individually. Collection, return, cancellation and stale updates suppress further alerts. The 72-hour limit is a conservative cut-off for old events. The push gives no collection deadline.

Transient failures return a non-success webhook response. Replaying the same signed event retries unfinished deliveries. No scheduled job is required. FCM acceptance and the Firestore receipt are separate writes. A process failure between them can repeat a send. Stable notification identifiers help combine repeats. A message already handed to FCM can still arrive after collection.

## Before enabling

`COLLECTION_PUSH_ENABLED` defaults to off. Enable it on the backend only when the companion app can register devices and handle notification taps. Use the existing Firebase Admin identity with permission to send FCM messages. Keep direct client access to `pushDevices`, `lockerPushReceipts`, orders and shipments restricted. iOS delivery requires a production-capable APNs credential and an app signed for push.

Verify the carrier event and locker metadata against a genuine cherry shipment. On an opted-in test phone, verify one arrival alert while the app is in the background, tap through to the correct order and replay the event to check duplicate suppression.
