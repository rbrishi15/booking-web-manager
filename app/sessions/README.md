# /app/sessions

**Owner:** Neoh (liang799)

`GET /api/sessions` provides UC2-01 discovery; see the
[discovery contract and page guide](../discover/README.md). Swagger documents
creation, discovery, visibility and cancellation. This guide covers creation and management.

UC2-02 supplies the Create Session API with Supabase bearer authentication and
atomic PostgreSQL persistence. When server settings are missing,
`POST /api/sessions` returns:

```json
{
  "error": {
    "code": "SESSION_API_UNAVAILABLE",
    "message": "Session creation is not available yet"
  }
}
```

The status is **503**. Valid server settings enable session creation after the
prerequisite migrations are applied. The [configuration guide](../../use-case-config/README.md)
records settings, ownership, and the dependency on PR #34 followed by migration 0006. Documentation and contract tests work
without credentials or a local Supabase stack.

## UC2-02: create-session wizard

UC2-03a visibility (PR #38) and UC2-03c cancellation (PR #41) are on `main`;
the creation wizard includes those dependencies by updating from `main`.
Apply the migration sequence in numbered order, including 0008 for custom pricing.
The wizard and pricing changes retain independent review of every affected area under the
[contribution workflow](../../docs/contributing-workflow.md).

`/sessions/create` uses a focused mobile shell and the standard desktop sidebar;
the hosted list has its own route-group layout and a create button in every state.
The three steps preserve drafts, validate before advancing, and focus the new
heading or first invalid field. The footer occupies layout space outside the
scrolling body; short screens can scroll every field fully into view.

Details start with Tennis and empty venue, dates and cost. The date dialog uses
Singapore time, with separate start/end dates for overnight bookings. Cost is
parsed directly into integer cents. Settings default to Private, eight slots,
a minimum headcount of four, and 4.5/5 reliability (90/100). Capacity is 2–8;
minimum headcount must be between two and the selected capacity. UC2-02 retains
this required configuration from the SRS. Reliability choices are no minimum or
3–5 in half-point increments. Pricing uses the selected sport's local photo and the
shared framework-independent calculation in `domain/sessions/pricing.ts`.

Before POST, the browser saves the exact payload and idempotency key in
user-scoped session storage. Duplicate submission is disabled. Network failures
and uncertain server errors freeze editing; a retry replays the saved payload.
Reload restores it. An authentication or service failure during replay retains
the pending submission because it cannot resolve the original result. A definitive
first-attempt rejection permits editing and a new key. Success clears pending
state and refreshes `/sessions?created=1` with feedback. Storage must be available
before a request is sent. Room tokens are not stored in browser submission state.

OneMap search is debounced, cancels/discards stale responses, and supports keyboard
selection and pagination. Selecting a venue fills its URA region; editing its name
clears lookup confirmation and region. Manual entry remains available when lookup
is unconfigured, fails, finds no results, or cannot resolve a region. This platform
coordinates venues booked elsewhere; lookup never creates a reservation.
See [venue configuration](../../use-case-config/README.md#venue-search-configuration).

## Configured HTTP contract

The [route module](../api/sessions/route.ts) exports ordinary async GET and POST
functions with the standard `Request` → `Promise<Response>` signature. Each
function encloses dependency loading, authentication and request handling in one
`try`/`catch`, then maps failures through its feature's response helpers.

[`loadDependencies`](../http/load-dependencies.ts) awaits the app-owned
[dependency getter](./server-dependencies.ts). It makes initialization failures
opaque before the feature mapper handles them as JSON 500s.
[`requireUserId`](../http/require-user-id.ts) invokes the endpoint's own
authenticator, rejects absent credentials and validates the verified UUID.
POST's authenticator also checks current active-account access before parsing or
replay. Dependencies and actor identities remain local values in each handler;
the helpers do not modify the Request or store shared actor state.

After loading [`SessionApiDependencies`](./dependencies.ts), the POST handler
authenticates, reads the request, creates a submission-scoped use case and invokes
[`CreateSessions.forBooker`](../../use-cases/sessions/CreateSessions.ts) directly.
Tests inject those dependencies and exercise the real helpers. The production
default never substitutes a fake authenticated user or persisted session.

`readCreateSessionRequest(request, bookerId)` reads JSON and delegates to the
existing parser. It distinguishes malformed JSON from an invalid request schema;
only the JSON/schema failures it identifies become 400 responses. Internal
validation errors from authentication or the use case remain opaque 500s.

[parseCreateSessionInput](./create-session-input.ts) validates the authenticated
user ID separately from the raw `{ idempotencyKey, booking, config }` body.
Booking timestamps are ISO strings with a timezone (`Z` or an offset), converted
to `Date` values for the use case. Unknown fields are stripped. Submission keys
must contain a non-whitespace character and be at most 200 characters; they are
preserved without trimming. Invalid input returns 400 before constructing a
submission use case.

The parser returns
`{ input: { bookerId, booking, config }, submission: { idempotencyKey } }`.
The trusted `bookerId` comes from authentication. Existing parser callers that
hold Date values serialize them first:

```ts
const parsed = parseCreateSessionInput(authenticatedUserId, {
  idempotencyKey,
  booking: {
    ...booking,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
  },
  config,
});
```

Direct use-case callers continue to supply Date-valued booking details.
Successful creation and replay return 201 with
`{ sessionId, roomToken, bookingShareCents }`. Omitted `config.pricePerSlotCents` rounds down equally:
1001 cents over three slots means 333 cents each, 999 cents collected when full,
and a 2-cent shortfall borne by the booker. An optional safe integer chosen price
is validated against `[max(1, ceil(s / 2)), min(2 × s, floor(MAX_SAFE_INTEGER / slots))]`,
where `s = floor(cost / slots)`. Above-cost collection is allowed. The accepted
price is immutable Session state hydrated from `booking_share_cents`; participation,
refund and settlement use that price and historical holds. Apply migration 0008
before deploying this behavior. See [ADR-0012](../../docs/adr/0012-booker-selected-session-pricing.md).
Creation moves no funds. `config.minimumHeadcount` remains required and is
persisted as `minimum_headcount`; it must be an integer between two and
`config.totalSlots`.

| Status | Outcome |
| --- | --- |
| 201 | Created session or replayed a successful submission |
| 400 | Malformed JSON or invalid request structure |
| 401 | No authenticated user |
| 403 | Inactive account, missing/unconfirmed email (`EMAIL_VERIFICATION_REQUIRED`), or unauthorized action |
| 404 | Authenticated User is missing from storage |
| 409 | Payout setup or session-state conflict |
| 422 | Invalid business values |
| 500 | Unexpected initialization, authentication, or persistence failure, or malformed authenticated identity |
| 503 | Required session server settings are missing |

Errors use `{ error: { code, message } }`. Unexpected failures return the fixed
`INTERNAL_ERROR` response. Retrying the same booker's submission key must return
the original result; an intended new session needs a new key. The authentication
integration must verify current active-account access and present confirmed email
before parsing or replay. The transaction repeats these checks before claiming
an idempotency key, including each database retry.
The persistence integration must commit the Session and replay result atomically.
See the [integration requirements](../../use-case-config/README.md#authentication-and-atomic-persistence).

## Documentation and validation

[Swagger UI](http://127.0.0.1:3000/api-docs) and `/api/openapi` publicly document
the configured contract and missing-settings response. Swagger's Try it out
sends a real request; configured creation requires a valid bearer token.
The creation operation is registered in [this feature's OpenAPI module](./openapi.ts).
Storybook's `Sessions/Create session` examples use the production wizard and
focused shell, with interaction and accessibility checks for all steps, date
editing, slot limits, price adjustments, lookup/fallback, stale results and submission
failures. `npm run test:sessions:integration` applies all migrations to a disposable
stack and verifies persistence, replay, real authentication, success navigation,
short-screen keyboard operation and the visibility-management regression. Browser
screenshots cover 390px, tablet (768px) and desktop (1280px).
The [shared OpenAPI guide](../openapi/README.md) explains how feature registrations
are assembled and how to add operations to the reference.

The [route tests](../../tests/app/sessions/create-session-route.test.ts) exercise
creation, replay, validation, and failures with injected dependencies and the
real use case. The [E2E tests](../../tests/e2e) load the documentation and check
503 against an unconfigured Next.js server. Separate service-backed suites
exercise real authentication, database persistence, concurrent replay and
rejection after deactivation; see the configuration guide for their commands.

The discovery page is covered by UC2-01. Participant removal and Realtime
subscriptions remain separate work.

## UC2-03a: visibility management

`/sessions` lists every open, upcoming session hosted by the signed-in user,
ordered by start time and session ID. It includes full sessions; their action list omits visibility changes. Availability includes direct-invitation reservations
through `Session.getAvailableSlots`; the UI does not calculate capacity itself.
Rows display confirmed visibility with per-row saving, success and error feedback.
The UI follows the returned HTTP actions. Existing cookie-authenticated server
actions and bearer APIs invoke the same use cases directly.

`PATCH /api/sessions/{sessionId}/visibility` accepts:

```json
{ "visibility": "PUBLIC" }
```

The alternative value is `PRIVATE`. A successful commit returns 200 with
`{ sessionId, visibility }`. The authenticated user supplies the booker identity;
the request cannot impersonate another owner. This sets a target value rather
than inverting stored state. Same-value requests still check current eligibility.
No funds move and no creation-style replay key is required.

| Status | Outcome |
| --- | --- |
| 200 | Visibility committed |
| 400 | Invalid session ID, malformed JSON, or invalid visibility |
| 401 | Missing or invalid authentication |
| 403 | Inactive application account or another session's owner |
| 404 | Missing User or Session |
| 409 | Session is full, started, or closed |
| 500 | Unexpected provider, hydration, transaction, or initialization failure |
| 503 | Management server settings are missing |

Errors retain the shared `{ error: { code, message } }` envelope. Application
access requires an active account, checked again on the complete User inside
the transaction. The underlying Booker behavior still allows an inactive owner;
that domain policy is deliberately unchanged. Ownership and session lifecycle
rules remain in `Booker.changeVisibility`.

Management requires migration 0007. It adds complete Session hydration facts and
ordered participation storage; see the [configuration guide](../../use-case-config/README.md#session-management-configuration).
The writer changes only visibility, preserving participants, holds, settlement
facts and ledger entries. The use case obtains its clock after loading and
locking state, so time spent waiting cannot authorize an already-started session.

Discovery refreshes in the background every second while visible and online.
The three-second acceptance target is measured after mutation success on a healthy
foreground page. Draft filters, focus, scroll and the current pagination cursor
stay in place. Offline or background tabs refresh when they become active again.
The browser suite exercises actual owner controls and an independently signed-in
participant's already-open discovery page through the disposable stack.

## UC2-03c: cancellation and wallet refunds

An active owner can cancel any OPEN, upcoming session, including a full one.
The page loads a server-calculated refund preview before explicit confirmation.
It shows affected participants separately from refund recipients and returns
outstanding held shares to in-app wallets. Venue cancellation is external.

Bearer endpoints (all responses use `Cache-Control: no-store`):

- `GET /api/sessions/{sessionId}/cancellation-preview` returns `{ sessionId,
  affectedParticipantCount, refundRecipientCount, totalRefundCents, previewVersion }`.
- `POST /api/sessions/{sessionId}/cancel` accepts `{ idempotencyKey, previewVersion }`
  and returns `{ sessionId, status: "CANCELLED", refundRecipientCount, totalRefundCents }`
  only after commit. The key is a UUID; the version is an opaque SHA256 string.

Identity comes from the verified bearer token or cookie. API routes and page
server actions invoke the same coordinators directly. Unknown request fields do
not override identity or refund amounts. Missing configuration is 503, invalid
input 400, unauthenticated access 401, inactive/foreign access 403, missing records
404, and lifecycle/stale-preview/request-key conflicts 409. Unexpected failures
and financial projection contradictions return opaque 500 errors.

The confirmation version covers authoritative cancellation state; visibility
changes alone do not invalidate it. A changed participant/hold requires a new
preview and another confirmation. Same-key retries return the original committed
result without extra refunds, after checking current active-account access.
Reuse the identical key and payload after an ambiguous failure. The page stores
that confirmed request in user-scoped session storage for reload recovery, and
retains completion feedback after the session disappears from upcoming results.
Cancellation is never a hard delete. Prior removed/cancelled participants and
terminal holds remain unchanged; live participants become CANCELLED, invitations
are cleared and outstanding holds are refunded at their historical amounts.
No withdrawal fee or payout-account readiness condition applies.

The existing discovery polling removes cancelled sessions within three seconds
for visible, online pages under healthy service conditions. Production needs
migration 0007 before the reader/endpoint; cancellation adds no migration.

## Lightweight contextual actions

Screen data carries the actions currently available to the actor. Each descriptor
has a stable `name`, an existing `href`, its HTTP `method`, and fixed `inputs`.
The existing controls still own presentation, user input and confirmation:

```json
{ "name": "set-visibility", "href": "/api/sessions/<id>/visibility", "method": "PATCH", "inputs": { "visibility": "PRIVATE" } }
```

`session-actions.ts` defines a small union for current session screens. Account
checks share `bookingAccountIneligibility` with creation/admission. Create opens
the existing wizard; payout readiness and submitted booking details remain
command-time validation. Hosted-session operations share Booker's pure ownership,
capacity and lifecycle preflights. The UI follows presence and fixed inputs;
commands authorize again against current state even if the screen is stale.

The cancellation preview includes a `cancel-session` POST action containing its
`previewVersion`. The existing dialog still previews refunds, asks for confirmation
and saves the original key/version before submission. A confirmed ambiguous
request remains recoverable even after the session and its actions disappear,
including through expired-login or access failures. Sign-in recovery keeps the
original request key and preview version.
Unverified hosts can still manage and cancel under the existing rules.

`/profile/email` adds an address for accounts without one or resends confirmation
for the server-read unconfirmed address. A nonblocking shell prompt links there.
Confirmation callbacks and the status recheck refresh the screen's actions; a
failed callback retains signed-in recovery guidance. Supabase's current
`email_confirmed_at` is authoritative, including already-confirmed accounts.

Public `/discover` and GET `/api/sessions` require no account. They continue to
expose only PUBLIC, OPEN, future summaries. Join production wiring is separate;
its adapter must enforce `403 EMAIL_VERIFICATION_REQUIRED` for entry and replay,
and use this descriptor shape only for endpoints that are actually integrated.
