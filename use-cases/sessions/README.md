# Session use cases

## UC2-02 Create Session

[`CreateSessions.forBooker(bookerId, booking, config)`](./CreateSessions.ts)
loads the complete User inside the transaction, constructs the Booking, calls
`user.asBooker().createSession(...)`, and saves the new Session. Business rules
and booking-share calculation remain in the domain. Creation moves no funds and
returns `{ sessionId, roomToken, bookingShareCents }`.

`bookerId` comes from authentication. `SessionBooking` contains venue name,
resolved region, sport, `Date` start/end values, and integer `totalCostCents`.
`SessionConfig` groups
`totalSlots`, `minimumHeadcount`, and optional `visibility`, `minimumReliability`, and
`invitedGroupId`. The module maps these fields explicitly into domain inputs.
Client-supplied shares, identities, account facts, or lifecycle fields cannot
override creation. The domain derives each booking share using integer-cent
floor division and preserves private visibility by default.

[parseCreateSessionInput](../../app/sessions/create-session-input.ts) uses Zod in
the app layer to validate the authenticated user ID separately from the raw
request, strip unknown fields, and return `{ input, submission }`. The raw
request contains `{ idempotencyKey, booking, config }`; `input` contains the
business action, while `submission` holds retry metadata. The parser converts
JSON ISO timestamps with a timezone into Dates. Venue resolution, including
OneMap, happens before invoking this module. The booking cost is booker-supplied;
creation does not verify a venue receipt or reserve a venue.

[`createSessionDependencies`](../../use-case-config/sessions.ts) assembles
authentication and a factory that creates a use case for each submission. The
[API route](../../app/api/sessions/route.ts) authenticates, parses, and invokes
`createSessions.forBooker(bookerId, booking, config)` directly. See the
[configuration guide](../../use-case-config/README.md) for dependency setup and
the [centralized API route tests](../../tests/app/sessions/create-session-route.test.ts)
for executable examples. Direct application callers continue to supply
Date-valued booking details.

The constructor accepts a [`SessionCreationTransaction`](./session-creation-transaction.ts),
the shared `Clock` and `IdGenerator`, and the platform `holdingAccountId` from
validated server configuration. The transaction capability exposes only the
User and Session repositories needed by creation. Session IDs, room tokens,
and time are obtained inside its callback; current account and payout readiness
come from the User loaded there. Production ID generators must supply
cryptographically random UUIDs because room tokens grant access to private sessions.

The compatibility adapter [RequestSessionCreationTransaction](../../lib/sessions/request-session-creation-transaction.ts)
captures the submission key and delegates to the existing shared `UnitOfWork`.
It namespaces keys by UC2-02, booker ID, and submission key. A fresh module and
adapter for a retry with the same key replay the original result, including when
valid details have changed. A new intended creation requires a new submission
key. Reusing a module for a different submission would reuse its captured key.
The HTTP authentication boundary checks that the current profile is active
before invoking this module, including for retries. Deactivated accounts cannot
retrieve stored room tokens through the API; eligible retries still replay
without repeating creation-specific payout or booking-time checks.

The underlying transaction adapter must atomically persist the session and
successful replay result, roll both back on failure, and serialize concurrent
requests for the same key. The wrapper supplies the namespace and restricted
repository interface; it does not implement database transactions. Parsing
failures throw `ZodError` in the app layer. Domain failures propagate as
`DomainError`; a `RangeError` from constructing request-derived Money, Booking,
or ReliabilityScore values becomes `DomainError("INVALID_INPUT")`. Persistence
failures propagate unchanged, including infrastructure `RangeError`s.
The [API route](../../app/api/sessions/route.ts) maps those errors to responses
documented in the [HTTP contract](../../app/sessions/README.md).

The [UC2-02 acceptance suite](../../tests/use-cases/UC2-02-create-session.test.ts)
exercises this interface with real domain objects, the transaction wrapper,
and a creation-only in-memory transaction fake. Parsing has a separate
[app suite](../../tests/app/sessions/create-session-input.test.ts). These tests
cover creation, replay, and failure behavior without establishing database
concurrency guarantees. The production PostgreSQL adapter directly implements
`SessionCreationTransaction`, loading the full User and inserting the new Session
in one transaction with the replay result.
[Database tests](../../tests/integration) verify hydration, rollback, concurrent
replay, and privileges; [E2E tests](../../tests/e2e) cross the running Next.js
server, Supabase Auth, and PostgreSQL. Session UI remains separate work.
