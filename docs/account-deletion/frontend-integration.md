# Account deletion: frontend and web handover

No Flutter screens or web interface were implemented in this backend task. The reference inspected read-only was `/Users/bradleyvenn/Downloads/MVP-main`; it is not proof of the deployed app version. The backend is now being integrated on `codex/account-deletion` from GitHub main `eedbbb6`. That identifies the review baseline, not the deployed backend or app version.

## Integration contract

The definitive request and response schemas are the backend's Swagger/OpenAPI routes. This handover must be read with the deployment gates in [the runbook](firebase-deployment.md). Do not enable the new frontend button against an unverified backend or unapproved policy.

The new client sends `X-Deletion-Contract: 1` when submitting `DELETE /api/auth/account`. This deliberately prevents the legacy client, which treats any successful response as completed deletion, from accepting an asynchronous request incorrectly. Identity always comes from the verified Firebase credential; never send a target UID or email for deletion.

The request endpoint requires a Firebase ID token from recent authentication. Force-refreshing an old token is not re-authentication: the client must re-authenticate using the user's supported sign-in provider when required. Do not demand a password from a social-sign-in user. Support accessible confirmation and error recovery; do not make users repeat unnecessary verification steps.

Status routes are `GET /api/auth/account/deletion` while the authenticated account remains available, and `POST /api/auth/account/deletion/status` using the separately generated opaque bearer status credential after login removal. A human-readable request reference does not authorise access. The latter route is for deletion status only, never order history, contact details or restoration of account access. Protect the token as a credential, keep it out of URLs, analytics and logs, and honour its expiry.

### Exact request and response

Before submitting, generate 32 cryptographically random bytes, encode using unpadded base64url (43 characters), and save the secret receipt securely. Send it as `X-Deletion-Status-Token`. Reuse that same secret on retries, including after a lost response. The server stores only a digest and does not return the secret. A new secret for an existing request returns `USE_EXISTING_STATUS_TOKEN`.

```http
DELETE /api/auth/account
Authorization: Bearer FIREBASE_ID_TOKEN
X-Deletion-Contract: 1
X-Deletion-Status-Token: CLIENT_GENERATED_43_CHARACTER_SECRET
Content-Type: application/json

{}
```

For a user linked to Apple, obtain a fresh Apple authorisation code for the configured client audience and include `{ "appleAuthorizationCode": "ONE_USE_CODE" }`. The server binds the exchanged subject to the linked Firebase provider UID, stores only an encrypted revocation token and removes it after successful revocation. Email/password or Google users must not be asked for an Apple code.

Successful acceptance is HTTP 202:

```json
{
  "success": true,
  "message": "Deletion request recorded. Check the status for progress.",
  "data": {
    "requestId": "d355117d-0316-4073-a960-92b378e4f422",
    "state": "accepted",
    "accountRestricted": true,
    "requestedAt": "2026-10-04T16:00:00.000Z",
    "updatedAt": "2026-10-04T16:00:00.000Z",
    "eraseTargetAt": "2026-11-01T16:00:00.000Z",
    "responseDueAt": "2026-11-04T16:00:00.000Z",
    "authenticationDeletedAt": null,
    "liveDataErasedAt": null,
    "completedAt": null,
    "statusTokenExpiresAt": "2027-01-02T16:00:00.000Z",
    "nextReviewAt": "2026-10-04T16:00:00.000Z",
    "reason": null
  }
}
```

Request receipt is the authoritative restriction point. The worker removes Authentication afterwards. Use `GET /api/auth/account/deletion` with a still-valid Firebase ID token to recover your own reference. Use `POST /api/auth/account/deletion/status`, `Authorization: Bearer SECRET_RECEIPT`, and JSON `{ "requestId": "UUID" }` after sign-out. If the acceptance response was lost, send `{}` with the saved secret to recover the reference without Authentication. A valid response contains the same `data` shape. All status responses are `Cache-Control: no-store`. The receipt expires after 90 days. A minimal status record survives earlier private audit expiry until that advertised date; use verified support for later enquiries about longer retained records.

| State | Meaning |
| --- | --- |
| `accepted` | Durable request and restrictions exist; cleanup queued or progressing between checkpoints |
| `processing` | Worker has the job lease |
| `retrying` | Incomplete processing; automatic retry scheduled; do not sign back in |
| `requires_review` | Operational, recipient or media review is needed; support acts on it |
| `retained` | Unnecessary live data erased; justified private evidence/financial retention remains |
| `completed` | Workflow and its tracked retention actions completed; independent-controller exceptions remain governed by their documented policies |

`authenticationDeletedAt`, `liveDataErasedAt` and `completedAt` are distinct milestones. Never infer any of them from HTTP success alone. `reason` is a safe generic code, not a list of private order/provider details.

| HTTP/error | Client action |
| --- | --- |
| 400 `STATUS_TOKEN_REQUIRED` / `INVALID_REQUEST` | Fix client contract; never include a target UID/email |
| 401 `AUTHENTICATION_REQUIRED` | Authenticate or use the secret receipt for an already accepted request |
| 401 `RECENT_AUTHENTICATION_REQUIRED` | Re-authenticate with the supported provider; `auth_time` must be within five minutes |
| 409 `DELETION_CONTRACT_REQUIRED` | Updated client required |
| 409 `APPLE_REAUTHORISATION_REQUIRED` | Obtain a fresh code for the linked Apple identity |
| 409 `USE_EXISTING_STATUS_TOKEN` / `REQUEST_ALREADY_ACCEPTED` | Recover existing reference/receipt; do not report a new deletion |
| 404 on receipt status | Uniform unknown/invalid/expired response; verified support if receipt lost |
| 429 `RATE_LIMITED` | Respect `Retry-After` |
| 503 | Disabled/unapproved configuration or temporary error; retain receipt and check status before retrying |

No frontend/web code or store configuration was changed. The body parser accepts only the documented request fields. API version checks are deliberate rollout safeguards.

## Required Flutter changes

The existing flow in `lib/features/auth/auth_view_model.dart` sends the DELETE request, treats any successful response as success, clears preferences, attempts sign-out and navigates to the welcome page. It ignores deletion state, request reference and completion timing. The confirmation in `lib/features/settings/widgets/settings_footer.dart` does not explain retained transactions or asynchronous processing.

1. Present a concise confirmation that distinguishes account closure, prompt removal of unnecessary data and specifically justified retained records. Show the approved privacy/retention link. Keep the destructive action explicit and keyboard/screen-reader accessible, with WCAG AA contrast.
2. Re-authenticate with the current provider when required, obtain a fresh Firebase ID token, and supply the contract header. For Apple, follow the supported authorisation/revocation contract below. Never log authentication or Apple credentials.
3. On an accepted request, save the minimum request/status receipt before clearing account storage. Mark the account closed locally and stop profile/listing/checkout/upload activity immediately. An accepted response is not a claim that all data has already been erased.
4. Cancel active uploads and outstanding network requests; stop Firestore listeners before clearing their caches. Remove cached user/profile/address/order/media data, queued offline writes, account-scoped image caches, push-token association and notification subscriptions where present. `SharedPreferences.clear()` alone does not establish that all personal data caches are gone.
5. Attempt Firebase and social-provider sign-out. Clear account state and leave authenticated navigation even if sign-out fails; show a safe local recovery message if needed. Do not report that the deletion request failed merely because local sign-out failed after acceptance. Server restrictions remain authoritative.
6. Show the request reference and a safe status/completion path after sign-out. Store any status capability separately from cleared user preferences using appropriate secure storage. For a web receipt, do not place it in a query string or expose it to third-party page scripts.
7. When status shows processing/retrying, retain the receipt and show a truthful pending message. Do not repeatedly resubmit a fresh deletion request. Let the backend retry without user activity.
8. Handle a lost response as an uncertain outcome. Recover status using the secret saved before submission and an empty JSON body on the receipt route, even after Authentication removal. If the secret has been lost, use verified support. Do not assure the user that no request exists.

The frontend's direct Firestore profile and address writes, direct product queries and Firebase Storage uploads must be tested against the reviewed restrictive rules. The inspected frontend archive's local `firestore.rules` allows all reads/writes until 31 December 2030. That local file is unsafe for deletion restrictions; the deployed rules are unknown. Backend checks cannot compensate for permissive direct-client access.

Profile upload naming currently uses `user_images/{firstname}_profile_picture.png`, which can collide across users. Move future uploads to a verified UID-owned path allowed by the reviewed Storage rules, including variants under the same ownership prefix. Product images currently use `products/{uid}/image_{timestamp}_{index}.jpg`. Coordinate this frontend change with backend media ownership handling and legacy remediation. Do not guess legacy ownership from the name.

## Outstanding orders and completion

A deletion request can be accepted while an order is active. Hide ordinary available listings and close unrelated activity immediately. The user must retain a usable route to fulfilment, refund and dispute support after Authentication removal. A status receipt must never grant order access; the support route needs independent identity verification and minimum disclosure.

The backend task does not build a new support portal, issue automatic refunds or cancel transactions. The launch owner must provide a working support destination and a documented verification process. Any retained case must have a reason, review date and release condition. Do not require users to reopen their old account to complete erasure.

Do not claim full completion while required cleanup or provider follow-up is outstanding. If completed live-data erasure and expiry of lawful retained evidence are separate milestones, display them distinctly using the actual backend state and approved wording. Completion confirmation must remain available after sign-out; if email confirmation is used, configure the sender and recipient lifecycle rather than assuming one exists.

## External Google Play deletion page

Provide a public HTTPS page that identifies cherry consistently with its Play listing. Its request route must be easy to find and usable without installing the app. Authenticate/re-authenticate on the web using the same Firebase project and supported providers, then submit the same backend request and show its receipt/status. A page that only tells users to reinstall the app is not sufficient. [Google Play account deletion guidance](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)

The web page should explain what is deleted, what may be retained, the approved periods and how to obtain support. Provide an accessible account-recovery/privacy-request fallback for users who cannot authenticate. The fallback must verify identity proportionately without confirming whether arbitrary email addresses have accounts. Do not add an unauthenticated UID/email deletion endpoint. Configure exact CORS origins if needed, avoid cookie-based unauthorised requests, redact sensitive headers and prevent tokens from entering referrers, analytics or error reports.

Publish the final URL in Play Console's Data safety deletion field. Review the iOS privacy disclosures and Google Play Data safety answers against the deployed data flow. Apple users must be able to initiate deletion within the app with proportionate confirmation and Apple token revocation where applicable. [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)

## Proposed user-facing wording awaiting policy approval

Confirmation:

> Delete your cherry account? Your profile and available listings will be hidden when we accept your request. We will remove personal data we no longer need as soon as possible. We may keep limited information needed to finish an order, resolve a dispute or meet a legal obligation. You will receive a request reference to check progress. This cannot be undone once data is erased.

Accepted:

> Your deletion request has been received. Your account is closed to new activity. Keep your request reference to check progress. Some information may remain temporarily for an existing order or a legal requirement.

Pending transaction:

> We are removing the information we no longer need. Limited information for an existing order is still required. You can contact support about that order without restoring your account.

Completed wording must match what the returned state actually guarantees, and disclose justified retained data separately. Do not display “all your data has been deleted” where financial evidence, provider records or recovery copies still remain. The 28-day target and other draft periods must not be published until approved in [the retention schedule](retention-policy.md).

## Frontend acceptance checks

| Case | Expected behaviour |
| --- | --- |
| Existing app without contract header | Safe compatibility error, no false completed-success screen |
| Password, Google and Apple users | Suitable re-authentication, no irrelevant password requirement, no credential logging |
| Stale token / recent sign-in requirement | Clear recoverable prompt; refreshing alone does not bypass the requirement |
| Accepted request with active order | Account restrictions, receipt and support remain usable; no refund/cancellation is implied |
| Lost response, duplicate tap or app restart | Recover existing request/status safely; no restored profile or duplicate financial effects |
| Local sign-out/preferences failure after acceptance | Leave account activity, preserve receipt, accurately report local problem |
| Stale second device / offline writes | API and deployed Firebase rules reject new activity and profile recreation |
| Open public listing, favourite or profile link | Deleted account's public data unavailable immediately after acceptance |
| Concurrent checkout or upload | Closure state enforced authoritatively; resulting owned orphan uploads reconciled |
| Status after Authentication removal | Works only with valid status capability; reference alone fails, expiry handled safely |
| Re-registration with same email/provider | Fresh UID/customer relationship, no old orders, media, cached profile or status inherited |
| Web request with app uninstalled | Entire authenticated request and receipt journey works independently |
| Screen reader, large text and keyboard navigation | Clear labels/focus, readable confirmation and status, no colour-only information |

Record app build, backend revision/artifact hash, project, rules version and observed evidence for every staging run. These checks have not been performed on a deployed app by this handover.
