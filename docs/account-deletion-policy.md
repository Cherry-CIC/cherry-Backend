# Account deletion and data retention policy

This document supersedes the earlier synchronous deletion guidance. The current implementation and proposed retention schedule are documented in [account deletion](account-deletion/README.md). The schedule requires organisational approval before production enablement.

## Account closure and erasure

1. Accept an authenticated request only after validating recent sign-in, the versioned client contract and the configured policy. Persist the request and account guard together before acknowledging acceptance.
2. Restrict new account activity and hide public profiles and listings. Acceptance means the request is recorded; it does not mean every copy has been erased.
3. Use the resumable worker to revoke/remove Authentication and erase unnecessary profiles, nested account data, per-user likes, available listings and verified owned media. Remove related likes and reconcile product counters transactionally.
4. Preserve only the fields needed for an existing order, a specific unresolved obligation or an approved retention purpose. Review holds and expire retained evidence separately. Account deletion must not itself refund, cancel a payment, change a charity allocation or release a payout.
5. Track ambiguous ownership, provider copies and exports as restricted review tasks. Stripe extension customer trees require their own evidence-bound approval. Provide status after sign-out through a private receipt.

Replacing a UID with a marker does not establish anonymity. Restricted references, hashes and retained transaction links remain personal data where identification is possible. Apply the approved fields, access controls and expiry rules in the [retention matrix](account-deletion/retention-policy.md).

A later sign-up must be a fresh account. Email equality alone must not reconnect old profiles, orders, media, likes or Stripe Customer relationships.

## Release requirements

Production acceptance and workers are disabled by default. A code review does not authorise a deployment. Release requires approved policy and notice wording, a complete deployed data inventory, compatible Security Rules, verified provider/extension handling, scheduled operations and an explicitly authorised staging environment. The Flutter journey, public deletion webpage and store declarations remain separate work.

Use the [frontend contract](account-deletion/frontend-integration.md), [operator runbook](account-deletion/firebase-deployment.md), [cloud preflight](account-deletion/cloud-preflight.md) and [verification record](account-deletion/verification.md) as the maintained sources. Do not restore the legacy synchronous deletion method.
