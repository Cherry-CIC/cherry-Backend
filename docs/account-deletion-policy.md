# Account Deletion And Data Retention Policy

This document defines the recommended backend approach for user account deletion in the Cherry backend.

## Goals

- Remove a deleted user's access immediately
- Erase profile data that is no longer needed
- Preserve only the minimum commerce history required for legal, operational, or reporting purposes
- Avoid reconnecting retained historical records to a new account created later with the same email

## Recommended Behaviour

When a user deletes their account:

1. Delete or disable Firebase Auth access immediately
2. Delete the Firestore user profile
3. Delete per-user likes and reconcile product like counters
4. Delete unsold listings owned by the user
5. Keep completed commerce records only where justified, but anonymise them

## Collection-Level Policy

### `users`

- Delete the user profile document

### `user_likes`

- Delete all like documents for the user
- Decrement the affected product `likes` counters so product totals remain accurate

### `products`

- If a product is unsold and not referenced by a retained order:
  - delete it
- If a product is referenced by historical orders that must be retained:
  - keep the product record
  - anonymise ownership by removing live user linkage

### `orders`

- Do not hard-delete completed order history by default
- Retain only where needed for legal, accounting, fraud, support, or dispute reasons
- Anonymise personal data:
  - replace `userId`
  - remove direct email identity
  - redact recipient name, phone, and detailed address where possible

### `shipments`

- Keep shipment records only where linked retained order history requires them
- Anonymise personal shipment fields:
  - parcel recipient name
  - parcel address lines
  - parcel email
  - parcel telephone
- Keep operational tracking metadata if justified:
  - provider
  - carrier
  - tracking number
  - tracking URL
  - shipment status

## Re-Signup Behaviour

If a person signs up again with the same email after deletion:

- they get a new Firebase Auth account and UID
- they are treated as a new account
- anonymised historical records do not reconnect automatically
- old deleted profile, likes, and unsold listings are not restored

## Current Backend Direction

The backend implementation should move from destructive hard deletion of all business records toward:

- hard deletion of access/profile/likes
- deletion of unsold listings
- anonymisation of retained order and shipment history

## Implementation Notes

- Avoid using a single large Firestore batch for all cleanup work; chunk operations safely
- Keep an explicit anonymised marker such as `deleted_user`
- Ensure account deletion updates product like counters
- Ensure future admin/reporting tools can distinguish anonymised historical records from active user-owned records
