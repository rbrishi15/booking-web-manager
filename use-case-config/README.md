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
