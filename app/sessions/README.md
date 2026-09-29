# /app/sessions

**Owner:** Neoh (liang799)

UC2-02 Create Session (server-side booking share computation), UC2-03 Manage
Session (UC2-03a Toggle Public/Private, UC2-03b Remove Participant), UC2-03c
Cancel Session. Session and Slot schema with row-level security policies.
Supabase Realtime wiring lives here to meet the 3-second slot propagation
requirement.

UC2-02 has a [CreateSessions module](../../use-cases/sessions/README.md), an
HTTP function [`handleCreateSession`](./create-session-handler.ts), and tests.
Use [`createSessionHandler`](../../use-case-config/sessions.ts) to connect the
HTTP function to authentication and application dependencies; the
[configuration guide](../../use-case-config/README.md) includes a complete example.

The handler authenticates before parsing JSON. [parseCreateSessionInput](./create-session-input.ts)
validates the authenticated user ID separately from the raw
`{ idempotencyKey, booking, config }` body with Zod. Booking timestamps must be
ISO strings with a timezone (`Z` or an offset); parsing converts them to `Date`
values for the business action. Unknown fields are stripped. The parser returns
`{ input: { bookerId, booking, config }, submission: { idempotencyKey } }`;
the trusted `bookerId` always comes from authentication.

Existing parser callers that hold Date values serialize them first:

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

Direct `CreateSessions.forBooker` callers continue to supply Date values.

The configured submission factory supplies a fresh `CreateSessions` instance
and [transaction wrapper](../../lib/sessions/request-session-creation-transaction.ts).
The handler invokes `forBooker(bookerId, booking, config)` and returns the direct
`{ sessionId, roomToken, bookingShareCents }` JSON result. Successful creation and
successful replay both return 201.

| Status | Outcome |
| --- | --- |
| 201 | Created session or replayed a successful submission |
| 400 | Malformed JSON or invalid request structure |
| 401 | No authenticated user |
| 403 | Inactive account or unauthorized action |
| 404 | Authenticated User is missing from storage |
| 409 | Payout setup or session-state conflict |
| 422 | Invalid business values |
| 500 | Authentication adapter failure, malformed authenticated identity, or other unexpected failure |

Errors use `{ error: { code, message } }`. Unexpected failures return the fixed
`INTERNAL_ERROR` response without exposing infrastructure error details.

Retrying the same booker's submission key returns the original result; an
intended new session needs a new key. The business method receives no retry
metadata. The function is not mounted as a route yet. Production authentication,
repositories and database transactions, migrations, OneMap, and UI remain
separate integration work.
