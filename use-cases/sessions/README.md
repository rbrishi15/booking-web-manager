# Session use cases

## UC2-01 Discover Sessions

`DiscoverSessions.forParticipant(participantId, criteria = {})` loads
one complete User within its discovery transaction and invokes
`user.asParticipant().assertCanDiscoverSessions()`. Only an active account is
required; payout setup, funds, memberships and reliability do not restrict browsing.
The use case captures the listing cutoff from its clock after eligibility succeeds.
The PostgreSQL reader selects public, open sessions starting after that instant,
applies text, sport, stored-region and start-time filters, and orders by start time
and ID. The use case returns `Promise<readonly DiscoveredSession[]>` containing
every matching summary, without a result cap. Full sessions stay discoverable.

Criteria group `text`, `sport`, `region` and `startsWithin: { from?, before? }`.
The reader receives only `criteria` and `now`; SQL has no cursor predicate or
page limit. Pagination is entirely app-owned: each request, including Next,
fetches all matching summaries, applies the cursor and selects a 20-item page.
Only that page reaches browser props or HTTP JSON. This deliberately accepts
the full-list read cost for school-project simplicity.
Complete actor hydration and summary reads share a repeatable-read transaction;
discovered Sessions are not hydrated, and no ledger unit of work or replay store
is needed. Missing or malformed related User state fails hydration. Each invocation
loads fresh User state and checks eligibility again. The app verifies identity,
validates external filters before User loading, converts Singapore date/time
bounds to instants and encodes/decodes opaque HTTP cursors. HTTP field names and
responses remain unchanged. See the
[discovery guide](../../app/discover/README.md) for its API and React state model.
OneMap resolution remains separate; this milestone filters stored regions.

## UC2-02 Create Session

[`CreateSessions.forBooker(bookerId, booking, config)`](./CreateSessions.ts)
loads the complete User inside the transaction, constructs the Booking, calls
`user.asBooker().createSession(...)`, and saves the new Session. Business rules
and booking-share calculation remain in the domain. Creation moves no funds and
returns `{ sessionId, roomToken, bookingShareCents }`.

`bookerId` comes from authentication. `SessionBooking` contains venue name,
resolved region, sport, `Date` start/end values, and integer `totalCostCents`.
`SessionConfig` groups
`totalSlots`, `minimumHeadcount`, and optional `visibility`, `minimumReliability`,
`invitedGroupId`, and `pricePerSlotCents`. The module maps these fields explicitly into domain inputs.
Client-supplied identities, account facts, or lifecycle fields cannot override
creation. The domain validates the chosen booking share, uses integer-cent floor
division when no price is supplied, and preserves private visibility by default.

[parseCreateSessionInput](../../app/sessions/create-session-input.ts) uses Zod in
the app layer to validate the authenticated user ID separately from the raw
request, strip unknown fields, and return `{ input, submission }`. The raw
request contains `{ idempotencyKey, booking, config }`; `input` contains the
business action, while `submission` holds retry metadata. The parser converts
JSON ISO timestamps with a timezone into Dates. Venue resolution, including
OneMap, happens before invoking this module. The booking cost is booker-supplied;
creation does not verify a venue receipt or reserve a venue.

[`createSessionDependencies`](../../use-case-config/sessions.ts) assembles
supplied authentication and a factory that creates a use case for each
submission. With integrations supplied, the
[API route](../../app/api/sessions/route.ts) authenticates, parses, and invokes
`createSessions.forBooker(bookerId, booking, config)` directly. Configured
production uses Supabase bearer verification and PostgreSQL persistence;
missing server settings return `503 SESSION_API_UNAVAILABLE`. See the
[configuration guide](../../use-case-config/README.md) for dependency setup and
the [centralized API route tests](../../tests/app/sessions/create-session-route.test.ts)
for executable examples. Direct application callers continue to supply
Date-valued booking details.

The constructor accepts a [`SessionCreationTransaction`](./session-creation-transaction.ts),
the shared `Clock` and `IdGenerator`, and the platform `holdingAccountId` supplied
by dependency assembly. The transaction capability exposes only the
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
The authentication integration must check current active-account access before
invoking this module, including for retries. This prevents deactivated accounts
from retrieving stored room tokens through the API; eligible retries still
replay without repeating creation-specific payout or booking-time checks.

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
concurrency guarantees. Service-backed database and authenticated HTTP tests
run on a separate disposable stack. The [configuration guide](../../use-case-config/README.md#configuration-and-integration-prerequisites)
records commands and the prerequisite group migration. The
[E2E tests](../../tests/e2e) check public documentation and the default 503
response against a running Next.js server without credentials or Supabase.
Session-creation UI remains separate work; UC2-01 supplies the discovery page.

## UC2-03a: manage visibility

`ToggleSessionVisibility.forBooker(bookerId, sessionId, visibility)` loads complete
User and Session state within `SessionManagementTransaction`, checks active
application access, captures the current time, calls
`user.asBooker().changeVisibility(...)`, then saves visibility. It returns only
`{ sessionId, visibility }` after the transaction commits. Repeating an explicit
target still applies all current access, time, lifecycle and capacity guards.
The application's active-account gate does not alter the Booker's domain policy.

`ListHostedSessions.forBooker(bookerId)` provides ordered summaries of all owned,
open, upcoming sessions, including full sessions. It derives available slots from
hydrated Session objects and exposes no room token, participant or payment details.

The capability supplies User loading, Session loading/listing and visibility-only
persistence. It does not expose ledger or payout operations. Production uses
serializable transactions with bounded retries; every retry reloads state and
obtains a fresh operation time. See the configuration guide for schema rollout
and the contract required of future concurrent lifecycle writers.

## UC2-03c: cancel sessions

`PreviewSessionCancellation.forBooker(bookerId, sessionId)` loads fresh complete
aggregates, checks active application access and invokes Booker cancellation
without saving it. Refund totals come only from returned financial instructions.
The version is calculated before mutation and covers cancellation-relevant state.

`CancelSession.forBooker(bookerId, sessionId, previewVersion)` checks loaded User
access before durable replay, then loads/locks the Session, gets current time,
invokes Booker, compares the preview and commits cancellation with refund
instructions and the response. Submission keys are supplied through assembly,
not business input. Same-key replay skips lifecycle/preview re-evaluation after
active access is checked; a fresh request against a closed session conflicts.
The underlying inactive-owner domain behavior is preserved. ADR-0013 records
preservation of prior terminal participation history.


## UC2-03b Remove Participant

`ListSessionParticipants` returns an active owner's ordered participant display
facts. `PreviewParticipantRemoval` computes an unsaved domain removal and quote;
`RemoveParticipant` invokes `user.asBooker().removeParticipant`, appends its refund
instructions, saves only that removal and stores the response atomically.
Application access precedes replay. The domain continues to own removal timing,
participant eligibility, full historical refunds and the rejoining restriction.
The transaction ports and preview-version port live in
`session-removal-transaction.ts`; PostgreSQL and hashing stay in `/lib/sessions`.
A successful removal frees capacity without performing waitlist promotion.
