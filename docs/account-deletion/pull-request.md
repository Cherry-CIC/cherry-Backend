## Summary

Replace synchronous account deletion with a durable request, immediate account restrictions and a resumable worker. The existing route cleans database records within the request and then removes Authentication, without durable progress, a receipt after sign-out or a complete retention lifecycle. The new contract separates acceptance, live-data erasure and justified retention expiry.

Preserve existing order and checkout obligations while removing unnecessary profiles, per-user likes, listings and owned media. Public profiles and like operations honour account guards. Buyer disputes and in-flight shipment creation preserve necessary records; Resend tasks cover transactional emails and label attachments, including buyer data sent to a seller. Stripe extension customer trees need evidence-bound review before erasure; stale approvals, interrupted attempts and recreated data require fresh review. Deletion does not itself refund, cancel payments or release payouts.

Production acceptance and workers remain disabled by default. This is a code change and handover, with the [frontend contract](frontend-integration.md), [retention decisions](retention-policy.md), [runbook](firebase-deployment.md) and [cloud preflight](cloud-preflight.md).

## Checklist

- [x] I ran `npm run build` against the final integrated checkout
- [x] I ran `npm test -- --runInBand` against the final integrated checkout
- [x] I updated Swagger comments if an API contract changed
- [x] I updated `.env.example` if config changed
- [x] I documented mock versus live behaviour if shipping or payment logic changed
- [x] I linked any relevant design, flow, or contract context for user-facing changes
- [x] I noted any follow-up work or known gaps

## Testing

Validated on 8 October against main `eedbbb6`: build, non-mutating lint and OpenAPI checks pass; 289 unit tests across 24 suites and 37 emulator tests across 6 suites pass. `git diff --check` passes. The emulator run exits 0 after Jest's one-second shutdown notice. See [verification](verification.md) for scope and the two inherited excluded test files.

The production dependency audit reports 4 high and 8 moderate inherited/transitive advisories, with no critical findings. No incompatible SDK upgrade is bundled into this change.

No staging deployment, provider sandbox, real Apple revocation or frontend end-to-end run has been performed. The existing Sendcloud signature middleware remains part of the integration; its deployed configuration still needs verification.

## Risk

Erasure is irreversible. Review Authentication sequencing, concurrent checkout/like writes, buyer and seller holds, counter reconciliation, retention expiry and provider ownership carefully. The Stripe extension's privileged writers must be guarded or stopped and drained before approved cleanup. No live extension configuration was changed.

Production requires approved policy and privacy wording, a verified deployed inventory including unresolved `product_listing`, compatible reviewed rules, provider/extension evidence, scheduled jobs and alerts, and explicitly authorised staging checks. Prototype rules need coordinated frontend changes. Flutter screens, the public deletion webpage and store declarations remain handover work.

Read-only Firebase discovery succeeded on 5 October; credentials were invalid again on 6 October. The deployed backend revision remains unverified. Dependency advisories and excluded tests are recorded in the verification document. No live data or configuration was changed.

This PR is for code review. Do not deploy the prototype rules or enable deletion until the release gates above are met.
