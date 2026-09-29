# Session use cases

## UC2-02 Create Session

`CreateSession.execute(actorUserId, request)` loads the complete User through the
transaction repository, constructs the Booking, calls
`user.asBooker().createSession(...)`, and saves the new Session. Business rules
and booking-share calculation remain in the domain. Creation moves no funds.

The future authenticated server boundary supplies `actorUserId` separately from
the request. The request contains an idempotency key; booking venue name, resolved
region, sport, `Date` start/end values and integer `totalCostCents`; slot count and
minimum headcount; and optional visibility, minimum reliability, and invited-group
ID. HTTP adapters must convert wire timestamps into Dates before calling it.
Venue and region resolution, including OneMap, belongs outside this coordinator.

Zod validates input structure and UUIDs and strips unknown fields. Domain
constructors and the Booker role validate business constraints. Boundary failures
throw `ZodError`; domain failures retain their existing `DomainError` or
`RangeError`. Adapters map those errors to transport responses.
The participant's share is always derived from the submitted total booking cost
and slot count using the domain's integer-cent floor division. A client-supplied
share, actor identity, payout status, or lifecycle field cannot override creation.
The booking cost is supplied by the booker; this use case does not verify a venue
receipt or reserve a venue.

Dependencies are the shared `UnitOfWork`, `Clock`, and `IdGenerator`, plus the
existing platform `holdingAccountId` from server configuration. Creation generates
the session ID and room token inside the transaction callback. Production ID
generators must supply cryptographically random UUIDs, since room tokens grant
access to private sessions. Creation preserves the domain's private visibility
default and returns `{ sessionId, roomToken, bookingShareCents }`.

Idempotency keys are encoded as a JSON tuple of UC2-02, actor ID, and caller key.
After validation, reusing a successful actor/key returns the original result,
even if valid request details have changed; a new session needs a new key. Failed
transactions must store neither the session nor a successful replay result.
The transaction adapter must atomically persist the session and replay result
and serialize simultaneous requests with the same key. Clock reads and ID
generation happen only when the transaction callback executes.

The [UC2-02 acceptance suite](../../tests/use-cases/UC2-02-create-session.test.ts)
uses real domain objects and a creation-only in-memory transaction fake. It
checks orchestration, replay, and failure behavior; it does not establish database
concurrency guarantees. Production repository/transaction adapters, schema/RLS,
auth wiring, route handlers, and UI remain separate work.
