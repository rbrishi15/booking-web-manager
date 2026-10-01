# /app/sessions

**Owner:** Neoh (liang799)

UC2-02 Create Session (server-side booking share computation), UC2-03 Manage
Session (UC2-03a Toggle Public/Private, UC2-03b Remove Participant), UC2-03c
Cancel Session. Session and Slot schema with row-level security policies.
Supabase Realtime wiring lives here to meet the 3-second slot propagation
requirement.

UC2-02 has a [CreateSessions module](../../use-cases/sessions/README.md) and a
[POST route](../api/sessions/route.ts) that directly authenticates, parses,
invokes the use case, and maps the response. The
[configuration guide](../../use-case-config/README.md) explains dependency
assembly; executable examples live in the
[centralized API route tests](../../tests/app/sessions/create-session-route.test.ts).

The route starts with `await getSessionDependencies()` from the app's
[server dependency getter](./server-dependencies.ts). The getter validates
settings through [readSessionServerSettings](./server-environment.ts) and
obtains [`SessionApiDependencies`](./dependencies.ts) from the synchronous
[`createSessionDependencies(settings)`](../../use-case-config/sessions.ts).
It shares pending and successful initialization within the runtime instance;
only failed initialization clears the cache for retry. The route continues to
map setup failures to an opaque JSON 500. This lazy setup is a local error
policy, not a Vercel or Clean Architecture requirement.

Awaiting the getter guarantees assembled dependencies, not database readiness.
Infrastructure factories own client and pool behavior; the pool is still
created only after authentication and request parsing succeed. The
[getter tests](../../tests/app/sessions/server-dependencies.test.ts) cover
initialization sharing and recovery, while the
[route lifecycle tests](../../tests/app/sessions/production-route.test.ts)
exercise the HTTP boundary.

The route authenticates before parsing JSON.
[parseCreateSessionInput](./create-session-input.ts) validates the authenticated
user ID separately from the raw `{ idempotencyKey, booking, config }` body with
Zod. Booking timestamps must be ISO strings with a timezone (`Z` or an offset);
parsing converts them to `Date` values for the business action. Unknown fields
are stripped. Submission keys must contain a non-whitespace character and be
at most 200 characters; they are preserved without trimming. Oversized keys
return 400 before creating a database pool. The parser returns
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
and [PostgreSQL transaction adapter](../../lib/sessions/postgres-session-creation-transaction.ts).
The route invokes `forBooker(bookerId, booking, config)` and returns the direct
`{ sessionId, roomToken, bookingShareCents }` JSON result. Successful creation and
successful replay both return 201. App-owned
[response helpers](./create-session-response.ts) map failures to the statuses
below.

| Status | Outcome |
| --- | --- |
| 201 | Created session or replayed a successful submission |
| 400 | Malformed JSON or invalid request structure |
| 401 | No authenticated user |
| 403 | Inactive account or unauthorized action |
| 404 | Authenticated User is missing from storage |
| 409 | Payout setup or session-state conflict |
| 422 | Invalid business values |
| 500 | Invalid server configuration, authentication adapter failure, malformed authenticated identity, or other unexpected failure |

Errors use `{ error: { code, message } }`. Unexpected failures return the fixed
`INTERNAL_ERROR` response without exposing infrastructure error details.

Retrying the same booker's submission key returns the original result; an
intended new session needs a new key. The business method receives no retry
metadata. The API is mounted at `POST /api/sessions`. Its Supabase bearer adapter
verifies the access token and current profile status before parsing the request
or starting the PostgreSQL transaction, including replay requests. The profile
lookup uses the caller's bearer identity. Inactive profiles return 403, missing
profiles return 404, and lookup failures return an opaque 500.
[Swagger UI](http://127.0.0.1:3000/api-docs) documents the request and supports
trying it with a local access token; `/api/openapi` serves its OpenAPI document.
See the [local API setup](../../supabase/README.md#session-api) and the
[database](../../tests/integration) and [E2E](../../tests/e2e) suites.
Registration and sign-in screens, session UI, and OneMap remain separate work.

Server settings require HTTPS for non-loopback Supabase URLs and
`sslmode=require`, `verify-ca`, or `verify-full` for non-loopback PostgreSQL
connections. Local `localhost`, `127.0.0.1`, and `::1` connections may use HTTP
and omit database TLS for the Supabase development stack. Invalid settings
return the same opaque 500 response before authentication or database IO.

Shares round down equally: 1001 cents over three slots means 333 cents each,
999 cents collected when full, and a 2-cent shortfall borne by the booker.
