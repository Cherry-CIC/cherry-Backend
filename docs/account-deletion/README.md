# Account deletion implementation

The backend now accepts a durable deletion request, blocks new account activity, removes owned live data through a resumable worker and separately manages justified retention. Production acceptance and workers are disabled by default. The current code review integrates this work with GitHub main `eedbbb6`; consult [verification](verification.md) for completed checks and remaining release requirements.

Read these documents in order:

1. [Verification and current limits](verification.md)
2. [Policy decisions and retention matrix](retention-policy.md)
3. [Frontend and web integration](frontend-integration.md)
4. [Firebase, deployment and operator runbook](firebase-deployment.md)
5. [Cloud discovery and staging plan](cloud-preflight.md)
6. [Changed files](changed-files.md)

Provider/recipient actions and ambiguous legacy media ownership are tracked review tasks. They are not silently treated as erased. The implementation does not delete real accounts, configure live Firebase, build Flutter/web screens or establish legal compliance/store approval by itself.

The restrictive Security Rules are prototypes. Their deletion controls passed the integrated emulator suite; frontend direct queries and legacy upload paths require coordinated changes before deployment. The [rules audit](security-rules-review.json) explicitly records that compatibility blocker.
