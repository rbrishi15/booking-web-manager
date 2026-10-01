# Use-case configuration

This folder owns dependency assembly. The app validates requests and handles
HTTP; use cases coordinate domain behavior through their ports. The session
feature currently defines those boundaries and its HTTP contract, with live
authentication and persistence integrations still pending.

The production `POST /api/sessions` route returns
`503 SESSION_API_UNAVAILABLE` with `Session creation is not available yet`.
Providing environment credentials does not enable session creation in this
version. The public Swagger page and OpenAPI document work without credentials.

## Dependency contract

The [POST route](../app/api/sessions/route.ts) awaits the app-owned
[`getSessionDependencies()`](../app/sessions/server-dependencies.ts). When
configured, it consumes [`SessionApiDependencies`](../app/sessions/dependencies.ts):

| Dependency | Responsibility |
| --- | --- |
| `authenticate(request)` | Verify the bearer token and current active-account access, returning the trusted user ID or `null` for invalid credentials. |
| `createForSubmission(submission)` | Construct a fresh use case exposing `forBooker`, with a transaction capturing this submission's retry key. |

The route owns the sequence and invokes the use case directly:

```ts
const dependencies = await getSessionDependencies();
// After authentication and parsing in POST:
const createSessions = dependencies.createForSubmission(submission);
const created = await createSessions.forBooker(bookerId, booking, config);
return Response.json(created, { status: 201 });
```

[`createSessionDependencies()`](./sessions.ts) is the assembly boundary. It
currently takes no arguments and returns capabilities that report unavailable.
Tests replace this factory with supplied authentication and an in-memory
transaction adapter while retaining the real `CreateSessions` use case. See the
[route tests](../tests/app/sessions/create-session-route.test.ts) for executable
examples. The production default reports unavailable until real integrations
are assembled; test fakes are confined to tests.

The app getter shares pending and successful initialization within each runtime
instance; only failed setup clears its cache for retry. The route maps unexpected
setup errors to opaque 500s. The default capabilities report deliberate
unavailability as 503. Authentication failures, parsing errors, and business
errors retain their distinct [HTTP responses](../app/sessions/README.md).

## Pending integrations

| Owner | Deliverable and dependency |
| --- | --- |
| Joseph | Authentication and approved profile/wallet provisioning from PR #20. The session authentication interface must verify the bearer identity and read current account status before every submission, including replay. |
| Neoh | Update and retarget his PR #24 to `main` after the prerequisite stack merges. Own session-side authentication wiring and persistence against the approved profile schema, including complete User hydration, Session persistence, and atomic submission replay. |
| Rishi | Coordinate merging the prerequisite stack through PR #18. Coordinate profile/session migration numbering and merge order with Joseph and Neoh. |

Profile and wallet provisioning belong to Joseph's backend work in PR #20.
This contract PR includes no profile/session migrations or concrete Supabase or
PostgreSQL adapters. Neoh's integration follow-up starts after Joseph's approved
authentication and profile-schema work in PR #20 reaches `main`. Allocate the
session migration number in the shared sequence after that dependency is settled.

The authentication implementation must return `null` for missing or invalid
credentials, reject inactive accounts as `INACTIVE_ACCOUNT` (403), and report
missing profiles as `NOT_FOUND` (404). Lookup failures remain infrastructure
errors (opaque 500). Its current-status check must precede use-case invocation
so a deactivated account cannot replay a stored private room token. Authenticated
identity always comes from verified credentials, never from the request body.

The transaction implementation must load a complete User as defined in
[ADR-0002](../docs/adr/0002-constructor-based-domain-hydration.md), atomically
persist the Session and replay result, roll both back on failure, and serialize
competing requests with the same booker/submission key. A successful replay
returns the original result even if valid booking details change; it does not
rerun creation-specific payout or booking-time eligibility. A new intended
creation requires a new key. Creation moves no funds.

Before activating the production route, the integration follow-up must verify:

- Real bearer verification and current active-account authorization, including
  rejection of replay after account deactivation.
- Complete User hydration and atomic Session/replay persistence, with rollback
  on failure and correct concurrent replay.
- Integer-cent booking shares and no ledger entries or payout intents from
  creation.
- Restored database integration and authenticated HTTP tests covering those
  behaviors with real services.

The prior tested implementation is preserved separately on
`tianpok/pr-24-integration-backup` at `f7567b9` and excluded from the current
contract PR diff.

## Architecture and validation

[ADR-0011](../docs/adr/0011-api-routes-invoke-use-cases.md) keeps route orchestration
in `/app`, dependency assembly here, integrations in `/lib`, and framework-free
workflows and rules in `/use-cases` and `/domain`. Each supplied submission
factory constructs a fresh use case and transaction; request identities and
transactions must not become shared mutable state.

`CreateSessions.forBooker(bookerId, booking, config)` receives business input.
Retry metadata is captured by the transaction adapter. The existing
[`RequestSessionCreationTransaction`](../lib/sessions/request-session-creation-transaction.ts)
wraps a supplied `UnitOfWork`; it does not provide a database implementation.

Contract/unit tests use `npm test`. `npm run test:e2e` builds and starts Next.js,
checks public Swagger/OpenAPI documentation, and verifies the default 503
response without credentials or local Supabase. It does not establish live
integration or database concurrency behavior.

[Swagger UI](http://127.0.0.1:3000/api-docs) renders the transport schemas;
`/api/openapi` serves OpenAPI 3.0.3. The generator is pinned to
`@asteasolutions/zod-to-openapi@7.3.4` for Zod 3; upgrade them together in separate
work. The [HTTP contract](../app/sessions/README.md) documents input and statuses.
