# /app/sessions

**Owner:** Neoh (liang799)

UC2-02 currently supplies the Create Session HTTP contract and Swagger
documentation. The production `POST /api/sessions` route returns:

```json
{
  "error": {
    "code": "SESSION_API_UNAVAILABLE",
    "message": "Session creation is not available yet"
  }
}
```

The status is **503**. Authentication and persistence integrations are pending;
the [configuration guide](../../use-case-config/README.md) records the required
interfaces, owners, and merge order. Documentation and contract tests work
without credentials or a local Supabase stack.

## Configured HTTP contract

The [POST route](../api/sessions/route.ts) awaits the app-owned
[dependency getter](./server-dependencies.ts). With
[`SessionApiDependencies`](./dependencies.ts) supplied, it authenticates,
parses the request, creates a submission-scoped use case, invokes
[`CreateSessions.forBooker`](../../use-cases/sessions/CreateSessions.ts)
directly, and maps its result or error. Tests inject those dependencies; the
production default never substitutes a fake authenticated user or persisted
session. Unexpected initialization errors return an opaque JSON 500.

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
| 503 | Required session integrations are unavailable; the current production response |

Errors use `{ error: { code, message } }`. Unexpected failures return the fixed
`INTERNAL_ERROR` response. Retrying the same booker's submission key must return
the original result; an intended new session needs a new key. The authentication
integration must verify current active-account access before parsing or replay.
The persistence integration must commit the Session and replay result atomically.
See the [integration requirements](../../use-case-config/README.md#pending-integrations).

## Documentation and validation

[Swagger UI](http://127.0.0.1:3000/api-docs) and `/api/openapi` publicly document
both the configured contract and current unavailable response. Swagger's
Try it out sends a real request and receives 503 while integrations are pending.

The [route tests](../../tests/app/sessions/create-session-route.test.ts) exercise
creation, replay, validation, and failures with injected dependencies and the
real use case. The [E2E tests](../../tests/e2e) load the documentation and check
503 against the running Next.js server. These checks establish the contract;
live authentication, database persistence, and concurrency need integration
coverage when their implementations land.

Registration and sign-in screens, session UI, OneMap, and later session
management and Realtime features remain separate work.
