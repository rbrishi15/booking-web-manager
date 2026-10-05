# Use-case configuration

## Discovery configuration

UC2-01 assembles its dependencies in `discovery.ts`, using the same validated
Supabase/PostgreSQL settings and lazy pool provider as creation. Its bearer
verification establishes identity only; the API validates the external query
before passing that identity to `DiscoverSessions.forParticipant(...)`. The page
uses cookie identity and invokes the same use case directly. The use case loads
one complete User and checks active-account eligibility through its Participant
role on every invocation. Creation retains its existing account checks before
creation or replay. Discovery has its own unavailable error and dependency getter.

`PostgresSessionDiscoveryTransaction` acquires the lazy pool inside `run()` and
uses the existing `PostgresTransactor` to give `PostgresUserReader` and
`PostgresSessionDiscoveryReader` one repeatable-read transaction executor. It uses
ordinary transaction mode because User hydration takes shared locks, and makes
one attempt with existing infrastructure-error propagation. It writes no ledger
entries and uses no replay store. Complete User hydration includes wallet history,
memberships and calculated reliability; incomplete or malformed state fails
instead of supplying partial facts. Only active account status limits discovery.

The adapter returns all matching public session summaries ordered by start and
session ID, with no cursor predicate or result cap. The app owns 20-item pagination
and opaque cursors: every request, including Next, fetches the entire matching
list, then sends only the selected page to the browser. It does not expose raw
rows, room tokens, or direct browser access to session tables. See the
[discovery guide](../app/discover/README.md) for filters, pagination, states,
Swagger and Storybook coverage. OneMap settings are not needed for stored-region
discovery.

## Session creation configuration

See [session management configuration](#session-management-configuration) below
for UC2-03a's separate dependency assembly and migration requirements.

This folder assembles session API dependencies. The app owns HTTP orchestration,
use cases coordinate domain behavior, and infrastructure adapters live in `/lib`.

## Dependency contract

`createSessionDependencies()` keeps its no-argument factory contract and returns
`SessionApiDependencies`:

| Capability | Responsibility |
| --- | --- |
| `authenticate(request)` | Verify a Supabase bearer token and current account status for every request, including replay. |
| `createForSubmission(submission)` | Construct a fresh `CreateSessions` and PostgreSQL transaction capturing this submission's retry key. |

The route authenticates, parses JSON, invokes `forBooker(bookerId, booking, config)`
and returns 201. The verified token supplies the booker identity; body identities
are ignored. No cookie session or mutable request identity is shared between calls.

`getSessionDependencies()` shares pending and successful assembly within a runtime.
Failed setup clears its promise for retry. PostgreSQL connections are pooled lazily
(maximum two per runtime) and use Vercel's pool lifecycle integration. Transactions,
submission keys and use cases are never shared mutable request state.
Restart the runtime after changing settings: successful assembly, including the
missing-settings fallback, remains cached within that runtime.

## Configuration and integration prerequisites

Session creation is enabled when `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are present. Missing or blank settings expose
capabilities returning `503 SESSION_API_UNAVAILABLE` with
`Session creation is not available yet`. Malformed settings return an opaque 500
and assembly can retry. Non-local database connections require TLS; non-local
Supabase URLs require HTTPS. Public Swagger/OpenAPI works without settings.
The service-role key is used by test provisioning and other account workflows,
not by session bearer verification.

Joseph's authentication and profile provisioning from PR #20 are on `main`.
Migration `0006_session_creation.sql` depends on **[PR #34](https://github.com/rbrishi15/booking-web-manager/pull/34)'s
`0005_regular_groups.sql`**. Rishi coordinates their numbering and merge order;
Neoh owns the session schema and wiring. Until PR #34 merges, final migration
acceptance and merge of this integration remain pending. Do not import its group
UI or another feature branch into this branch.

Migration 0006 creates payout accounts, sessions, participations and fund holds.
It consumes the existing group tables and attaches PR #34's
`sessions_lock_invited_group` trigger. The trigger locks an existing invited group
while creation commits, so a concurrent archive sees unsettled sessions. It does
not add group-existence or membership eligibility rules. Browser roles cannot
read session room tokens, payout setup or participation facts directly.

## Authentication and atomic persistence

Missing, malformed, rejected or expired bearer credentials return 401. Current
inactive accounts return `INACTIVE_ACCOUNT` (403); missing profiles return
`NOT_FOUND` (404). Provider or lookup failures return opaque 500s. Current account
status is read before every creation or replay, preventing a deactivated account
from retrieving a stored private room token.

The PostgreSQL reader hydrates a complete User through domain constructors:
profile and auth email, optional payout setup, wallet identity and **all** committed
ledger entries, memberships, and reliability calculated from attendance history.
Missing required related facts or malformed stored data fail instead of inventing
an empty wallet or default history. Reads share a repeatable-read transaction;
account and payout rows are locked during creation.

The creation adapter uses the existing ledger unit of work and idempotency store.
Its key is `JSON.stringify(["UC2-02", bookerId, submission.idempotencyKey])`.
The fingerprint includes only this stable identity, so changed valid booking
input still replays the first result. Session and response are committed together,
rolled back together, and competing claims serialize. Serialization failures and
deadlocks retry the whole transaction up to three attempts. A replay does not
rerun creation-specific payout or booking-time eligibility; a new creation needs
a new key. Creation writes no ledger entries or payout intents.

## Validation

- `npm test`: domain, use-case, route, auth, configuration and wiring unit tests.
- `npm run test:e2e`: public Swagger/OpenAPI and unconfigured 503 HTTP coverage;
  the test server explicitly clears session settings.
- `npm run test:integration`: real database creation, complete hydration beyond
  200 entries, rollback, concurrent replay and group archive concurrency.
- `npm run test:e2e:integration`: real authenticated HTTP creation and replay,
  rejection after deactivation, identity spoofing prevention and response mapping.
- `npm run test:sessions:integration`: both service-backed suites on one stack.

The service-backed commands require Docker and the Supabase CLI on PATH. They
create a separate disposable stack on ports **55321/55322**, use its local keys
in memory, and remove its containers and volumes afterwards. They never reset
or migrate the developer stack on 54321/54322. The old draft
`0005_session_creation` installed in a local stack is not the approved migration
sequence and must not be used to establish acceptance for this branch.

Before PR #34 lands, an external copy of its SQL may be supplied **only to the
isolated test stack**:

```bash
SESSION_TEST_PREREQUISITE_SQL=/absolute/path/0005_regular_groups.sql npm run test:sessions:integration
```

The runner prints the preview SQL's SHA256 and labels acceptance as pending. It
copies no source into this repository. After PR #34 merges, update from `main`
and rerun without this variable against the merged sequence before integration.
Tests provision eligible payout fixtures; production payout setup remains the
responsibility of its own workflow. Session UI and later lifecycle adapters are
separate work. See the [HTTP contract](../app/sessions/README.md).

### Local validation, 2026-10-01

Typecheck, lint, production build, 827 active unit tests, nine database integration
tests, four authenticated HTTP tests, and three public documentation/unavailable
HTTP tests passed. The service-backed runs used PR #34 at
`f9481b61211a9e96b24cf808cb6062e18f651787`, with prerequisite SQL SHA256
`cd1be0e3eeb1a82648a25ff2c9585407ab7f794798599d818ba743d30bd22a0e`.
This is preview validation; rerun against the merged prerequisite before integration.

## Session management configuration

`session-management.ts` assembles `ToggleSessionVisibility` and
`ListHostedSessions` using the existing Supabase/PostgreSQL settings, lazy pool,
complete User reader and a dedicated `PostgresSessionManagementTransaction`.
The management getter has the same retryable initialization boundary as creation.
Bearer verification establishes current active-account access; the coordinator
rechecks that access within its transaction. The page uses verified cookie
identity and invokes the same coordinator through a server action.

Apply **0007_session_management.sql before deploying management**. Its additions
are nullable settlement JSON, non-null payout-history arrays, and an
identity-backed participant `list_position` unique within each session. The
stored batch uses domain field names, ISO dates and integer `amountCents` values
in place of Money objects. The reader constructs validated domain values; the
visibility writer never changes those settlement fields or participant positions.

The migration accepts creation-only data: no participation rows and only OPEN
sessions. It aborts atomically if that assumption is false because migration 0006
cannot supply the original participant order or complete settlement history.
Do not delete rows or invent histories to pass this preflight. Existing lifecycle
data requires a separately verified backfill before applying the migration.
The existing creation writer uses the new empty-history defaults unchanged.

Each management operation runs at SERIALIZABLE isolation and retries its complete
transaction at most three times on serialization failures/deadlocks. The shared
transaction helper retains REPEATABLE READ as its default for existing callers.
A visibility mutation loads User, locks Session, hydrates the complete participant
list and holds, obtains the current time, applies the Booker command and updates
only visibility. Mapping failures are infrastructure errors; SQL errors retain
their retry classifications. Rejected operations and failed commits roll back.

**Concurrent-writer contract:** future commitment, withdrawal and other lifecycle
adapters that read/write these invariants must also use SERIALIZABLE transactions
and whole-transaction retries. The visibility tests model those writers and
accept either valid serial ordering. This does not guarantee consistency for
arbitrary direct SQL or lower-isolation lifecycle writers. Agree that integration
boundary with Yajie and Rishi before those adapters are merged.

Neoh owns migration 0007 and the feature adapters. Rishi coordinates migration
numbering/merge order and reviews the shared transaction helper; follow the
[contribution workflow](../docs/contributing-workflow.md) for independent feature
review. Recheck the next migration number when updating from main. No review or
deployment approval is implied by local test success.

Run `npm run test:sessions:integration` for real database and authenticated browser
coverage. The existing disposable runner applies the full merged migration
sequence on 55321/55322, never a developer or hosted database. Browser acceptance
uses two identities to verify an already-open discovery view updates within
three seconds after an owner changes visibility. The public suite also checks
the management endpoint's unconfigured response and OpenAPI documentation.

### UC2-03a validation, 2026-10-02

Typecheck, lint, the production build, 1,233 unit tests, 136 Storybook tests,
33 database integration tests, 16 authenticated browser tests and seven public
browser tests passed against the merged migration sequence through 0007. The
authenticated suite verifies both visibility directions within three seconds,
preserved draft filters and pagination, refresh/navigation races, polling cleanup
and a 390px mobile layout. Database validation used only the disposable stack.

## Session cancellation configuration

`cancellation.ts` assembles a shared read-only preview and a submission-scoped
cancellation transaction. No additional settings or schema migration are needed;
apply migration 0007 from PR #38 before deployment. The complete Session reader
and User reader are shared with visibility management. No PR #39 or #40 source
is required by this workflow.

`PostgresSessionCancellationTransaction` uses SERIALIZABLE, session row locks and
at most three whole-transaction attempts for serialization failures/deadlocks.
Current User access is checked before the idempotency claim, including replay.
Keys are namespaced by UC2-03c and actor; the fingerprint includes session ID and
preview version. The existing idempotency store and ledger writer use the same
SQL executor as the narrow lifecycle writer. Refund entries, child/session state
and validated JSON replay response commit or roll back together. No network or
payment-provider call runs in this transaction. The shared money implementation
and default transaction isolation remain unchanged.
All loaded session holds, including preserved terminal holds, are reconciled
against the ledger projection's identities, original/outstanding cents and
settlement kind before applying cancellation. Contradictions fail atomically.

Conflicting future lifecycle writers must follow the same serializable contract.
Concurrency tests model that contract and do not guarantee safety for arbitrary
lower-isolation direct SQL. Neoh owns cancellation adapters; request Harrison's
ledger integration review and Rishi's domain/transaction review and independent
session-area review assignment. This feature stacks on the latest PR #38; merge
#38 first, update from main, retarget and rerun integration before merging it.

### UC2-03c validation, 2026-10-02

Typecheck, lint, production build, 1,278 unit tests, 142 Storybook tests,
47 database integration tests, 20 authenticated browser tests and eight public
browser tests passed. Both UC2-03c acceptance TODOs are replaced. Cancellation
coverage verifies actual historical refund amounts, retained terminal history,
atomic rollback, same/different-key concurrency, serializable lifecycle races,
stale-preview reconfirmation, reload recovery after a lost committed response,
full sessions and a 390px dialog. Browser acceptance measures discovery removal
within three seconds of the successful response using separate identities.
All database/authentication runs used only the disposable 55321/55322 stack,
with migrations through PR #38's 0007; its containers and volumes were removed.
Revalidate against main after the parent PR merges before integration.


## Participant removal configuration (UC2-03b)

`removal.ts` assembles `ListSessionParticipants`, `PreviewParticipantRemoval`
and submission-scoped `RemoveParticipant` instances with the existing session
server settings, pool and identity authenticator. Missing settings return
`SESSION_REMOVAL_UNAVAILABLE` (503); there are no new settings or migrations.
Apply the merged schema through 0007 before enabling the feature.

Read and write adapters use SERIALIZABLE transactions with whole-operation
retries, up to three total attempts. Reads hydrate complete Users and Sessions;
participant names use SQL on the same connection, never an HTTP request inside
the transaction. All session hold projections are checked against persisted
holds before computing refunds. Malformed storage is an infrastructure failure.

Writes change only the selected participation's status and hold settlement
fields. The refund ledger entry, REMOVED/REFUNDED state and durable response
commit or roll back together. The idempotency namespace is
`JSON.stringify(["UC2-03b", bookerId, idempotencyKey])`; the fingerprint contains
session ID, participation ID and preview version. Reusing a key for another
target conflicts. Replays recheck current active-account access and return the
original committed response, even if the session later starts or is cancelled.

The same lifecycle-writer concurrency contract as management/cancellation
applies. Tests model SERIALIZABLE admission and withdrawal under a session row
lock until Yajie's production adapters reach main. PR #45 proposes READ COMMITTED;
this feature does not adopt that change or claim compatibility without the
combined race tests and an agreed contract with Yajie and Rishi.

### Pending integration and review

This feature is based on main and imports no source from other open branches.
The intended merge order is #39, #44, then this UC2-03b feature. After #44 lands,
Neoh updates from main and adapts the participant navigation/removal eligibility
to its contextual action descriptors, retaining the financial preview and retry
contract. Rerun typecheck, lint, unit, Storybook and disposable database/browser
checks on the combined tree before marking the PR ready. Rishi coordinates an
independent session reviewer; Harrison reviews the financial integration.
Waitlist promotion remains Yajie's separate responsibility, not a prerequisite
for this removal/refund slice or part of its success response.
