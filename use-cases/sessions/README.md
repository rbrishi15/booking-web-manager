# Session use cases

## UC2-02 Create Session

[`CreateSessions.forBooker(bookerId, booking, config)`](./CreateSessions.ts)
loads the complete User inside the transaction, constructs the Booking, calls
`user.asBooker().createSession(...)`, and saves the new Session. Business rules
and booking-share calculation remain in the domain. Creation moves no funds and
returns `{ sessionId, roomToken, bookingShareCents }`.

`CreateSessionInput` groups the parser's plain TypeScript output. Its `bookerId`
comes from authentication; its `booking` is a `SessionBooking` containing venue
name, resolved region, sport, `Date` start/end values, and integer
`totalCostCents`. `SessionConfig` groups
`totalSlots`, `minimumHeadcount`, and optional `visibility`, `minimumReliability`, and
`invitedGroupId`. The module maps these fields explicitly into domain inputs.
Client-supplied shares, identities, account facts, or lifecycle fields cannot
override creation. The domain derives each booking share using integer-cent
floor division and preserves private visibility by default.

[parseCreateSessionInput](../../app/sessions/create-session-input.ts) uses Zod in
the app layer to validate the authenticated user ID separately from the raw
request, strip unknown fields, and return `{ input, submission }`. The raw
request contains `{ idempotencyKey, booking, config }`; `input` contains the
business action, while `submission` holds retry metadata. Controllers convert
wire timestamps into Dates before parsing. Venue resolution, including OneMap,
also happens before invoking this module. The booking cost is booker-supplied;
creation does not verify a venue receipt or reserve a venue.

Compose the module for each submission:

```ts
const { input, submission } = parseCreateSessionInput(
  authenticatedUserId,
  rawRequest,
);
const createSessions = new CreateSessions({
  transaction: new RequestSessionCreationTransaction(unitOfWork, submission),
  clock,
  ids,
  holdingAccountId,
});

const { bookerId, booking, config } = input;
const result = await createSessions.forBooker(bookerId, booking, config);
```

The constructor accepts a [`SessionCreationTransaction`](./session-creation-transaction.ts),
the shared `Clock` and `IdGenerator`, and the platform `holdingAccountId` from
validated server configuration. The transaction capability exposes only the
User and Session repositories needed by creation. Session IDs, room tokens,
and time are obtained inside its callback; current account and payout readiness
come from the User loaded there. Production ID generators must supply
cryptographically random UUIDs because room tokens grant access to private sessions.

The app-owned [RequestSessionCreationTransaction](../../app/sessions/request-session-creation-transaction.ts)
captures the submission key and delegates to the existing shared `UnitOfWork`.
It namespaces keys by UC2-02, booker ID, and submission key. A fresh module and
adapter for a retry with the same key replay the original result, including when
valid details have changed. A new intended creation requires a new submission
key. Reusing a module for a different submission would reuse its captured key.

The underlying transaction adapter must atomically persist the session and
successful replay result, roll both back on failure, and serialize concurrent
requests for the same key. The app wrapper supplies the namespace and restricted
repository interface; it does not implement database transactions. Parsing
failures throw `ZodError` in the app layer, domain failures retain their existing
`DomainError` or `RangeError`, and persistence failures reject the operation.
Controllers map those errors to transport responses.

The [UC2-02 acceptance suite](../../tests/use-cases/UC2-02-create-session.test.ts)
exercises this interface with real domain objects, the app transaction wrapper,
and a creation-only in-memory transaction fake. Parsing has a separate
[app suite](../../tests/app/sessions/create-session-input.test.ts). These tests
cover creation, replay, and failure behavior without establishing database
concurrency guarantees. Production repository/transaction adapters, schema/RLS,
auth wiring, route handlers, and UI remain separate work.
