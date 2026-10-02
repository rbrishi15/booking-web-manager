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
`{ sessionId, roomToken, bookingShareCents }`. Shares round down equally:
1001 cents over three slots means 333 cents each, 999 cents collected when full,
and a 2-cent shortfall borne by the booker. Creation moves no funds.

| Status | Outcome |
| --- | --- |
| 201 | Created session or replayed a successful submission |
| 400 | Malformed JSON or invalid request structure |
| 401 | No authenticated user |
| 403 | Inactive account or unauthorized action |
| 404 | Authenticated User is missing from storage |
| 409 | Payout setup or session-state conflict |
| 422 | Invalid business values |
| 500 | Unexpected initialization, authentication, or persistence failure, or malformed authenticated identity |
| 503 | Required session server settings are missing |

Errors use `{ error: { code, message } }`. Unexpected failures return the fixed
`INTERNAL_ERROR` response. Retrying the same booker's submission key must return
the original result; an intended new session needs a new key. The authentication
integration must verify current active-account access before parsing or replay.
The persistence integration must commit the Session and replay result atomically.
See the [integration requirements](../../use-case-config/README.md#authentication-and-atomic-persistence).

## Documentation and validation

[Swagger UI](http://127.0.0.1:3000/api-docs) and `/api/openapi` publicly document
the configured contract and missing-settings response. Swagger's Try it out
sends a real request; configured creation requires a valid bearer token.
The creation operation is registered in [this feature's OpenAPI module](./openapi.ts).
The [shared OpenAPI guide](../openapi/README.md) explains how feature registrations
are assembled and how to add operations to the reference.

The [route tests](../../tests/app/sessions/create-session-route.test.ts) exercise
creation, replay, validation, and failures with injected dependencies and the
real use case. The [E2E tests](../../tests/e2e) load the documentation and check
503 against an unconfigured Next.js server. Separate service-backed suites
exercise real authentication, database persistence, concurrent replay and
rejection after deactivation; see the configuration guide for their commands.

The discovery page is covered by UC2-01. Session-creation UI, OneMap,
participant removal and Realtime subscriptions remain separate work.

## UC2-03a: visibility management

`/sessions` lists every open, upcoming session hosted by the signed-in user,
ordered by start time and session ID. It includes full sessions with a disabled
control and explanation. Availability includes direct-invitation reservations
through `Session.getAvailableSlots`; the UI does not calculate capacity itself.
Rows display confirmed visibility with per-row saving, success and error feedback.
The cookie-authenticated action and bearer API invoke the same use case directly.

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
