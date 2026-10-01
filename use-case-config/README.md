# Use-case configuration

This folder assembles authentication, use cases, and infrastructure through
plain functions and constructors. It owns dependency wiring only: the app
validates settings and handles HTTP; infrastructure owns resource policies.
`SessionConfig` is different: it contains the booker’s per-session choices,
such as capacity and visibility.

## Setup

The [POST route](../app/api/sessions/route.ts) awaits the app-owned
[`getSessionDependencies()`](../app/sessions/server-dependencies.ts), then
uses the returned [`SessionApiDependencies`](../app/sessions/dependencies.ts)
to authenticate, parse, invoke `CreateSessions.forBooker(...)`, and return a
response:

```ts
const dependencies = await getSessionDependencies();
// After authentication and parsing in POST:
const createSessions = dependencies.createForSubmission(submission);
const created = await createSessions.forBooker(bookerId, booking, config);
return Response.json(created, { status: 201 });
```

| Dependency | Purpose |
| --- | --- |
| `authenticate(request)` | Verify the bearer token and current active profile; return its authenticated user ID or `null` for invalid credentials. |
| `createForSubmission(submission)` | Supply a use case exposing `forBooker`, with a fresh transaction adapter that captures this submission’s retry key. |

The getter validates settings and calls the synchronous
[`createSessionDependencies(settings)`](./sessions.ts) factory. That factory
selects the Supabase bearer and PostgreSQL transaction adapters through
infrastructure factories. It supplies the system clock, UUID generator,
and platform holding-account ID when constructing `CreateSessions` inside the
submission callback. The API receives these two capabilities instead of raw
pool, clock, ID, or transaction dependencies.

The factory's input is a plain `SessionServerSettings` object with `databaseUrl`,
`supabaseUrl`, and `supabaseAnonKey`. The app's
[server environment reader](../app/sessions/server-environment.ts) validates
`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
before wiring runs. For hosted serverless use, supply a transaction-pooler
database connection with TLS; for local development use the
[Supabase setup](../supabase/README.md#session-api).

To replace an implementation, change its constructor or infrastructure factory
in [`sessions.ts`](./sessions.ts). Callers can also replace an individual API
dependency while preserving the selected persistence implementation:

```ts
const dependencies: SessionApiDependencies = {
  ...createSessionDependencies(settings),
  authenticate: authenticateRequest,
};
```

See the [API route tests](../tests/app/sessions/create-session-route.test.ts) for
executable examples using fake authentication, the real use case, and an
in-memory transaction adapter. Database integration tests live in
[tests/integration](../tests/integration); real server tests live in
[tests/e2e](../tests/e2e). Keep executable tests in those folders.

## Lifetimes and retries

`getSessionDependencies()` starts initialization on its first call and caches
its Promise in the runtime module. Concurrent requests share pending setup;
later requests reuse the successfully assembled dependencies. Only an
initialization rejection clears this cache so a later call can retry.
Authentication, request parsing, and transaction failures leave successful
setup cached. This cache is local to the runtime instance, not shared across
instances.

Lazy setup lets initialization failures reach the route's opaque JSON 500
response. This is the project's error policy, not a requirement of Vercel or
Clean Architecture. Module-level initialization is possible, but its failures
happen before the request handler can map them to that response. Awaiting the
getter means dependencies are assembled, not that the database is connected
or ready; setup adds no artificial delay or connection probe.

After a cold start, warm requests share the getter's cached dependencies.
Scaling out starts independent instances with their own caches and pools.
Configuration selects implementations; infrastructure factories own resource
behavior:

- [`createPostgresPoolProvider`](../lib/database/postgres-pool.ts) captures the
  validated connection string and returns a memoized pool getter. Pool creation
  is independently lazy: it happens only when the route creates a use case
  after authentication and request parsing succeed. The provider owns pool
  options and idle-error logging.
- [`createSupabaseAuthClient`](../lib/supabase/bearer-client.ts) configures the
  stateless auth client, which warm requests reuse. Profile authorization uses
  a separate request-scoped client carrying the verified bearer token, so RLS
  sees that user's identity without changing shared client state.
- [`systemClock` and `uuidGenerator`](../lib/system.ts) supply time and random
  identities without request-specific state.

The initial pool settings are `max: 2`, `min: 0`, `idleTimeoutMillis: 5000`, and
`connectionTimeoutMillis: 5000`. The two-connection cap applies to each instance;
total connections grow as instances scale out. Check these initial limits
against the hosted project's connection budget and workload before deployment.

Infrastructure calls `attachDatabasePool(pool)` once when creating each pool.
On Vercel, the helper lets idle connections close before the instance is
suspended; it skips Vercel lifecycle waiting during local runs. See
[Vercel's connection-pooling guide](https://vercel.com/kb/guide/connection-pooling-with-functions).

Each parsed submission gets a fresh transaction adapter and `CreateSessions`
instance through `createForSubmission`. Request-specific identities and
transactions are never cached in the shared dependency object. Authentication
finishes before the database transaction begins. Inside it, the adapter loads
the complete User, the domain creates the Session, and the adapter commits the
Session and replay result atomically.

A retry from a currently active account uses the same key and receives the
original result, even if valid submitted details have changed. The key
identifies the logical submission;
an intentional new creation needs a new key. Keys are isolated by UC2-02 and
authenticated booker. Failed transactions are retryable. PostgreSQL serializes
competing claims; serialization/deadlock failures retry up to three attempts.

Every HTTP request checks current profile status before invoking the use case,
including retries: inactive accounts receive `403 INACTIVE_ACCOUNT`, missing
profiles receive `404 NOT_FOUND`, and lookup failures remain opaque `500`
responses. This access check does not rerun creation-specific payout or booking
time eligibility for a successful replay.

The [dependency getter tests](../tests/app/sessions/server-dependencies.test.ts)
cover shared initialization, reuse, and retry after setup failure. The
[route lifecycle tests](../tests/app/sessions/production-route.test.ts) and
[environment tests](../tests/app/sessions/server-environment.test.ts) retain
coverage of configuration errors and authentication/parsing before pool creation.

## Configuration migration

Remove calls to `createSessionHandler(dependencies)` and the former
`handleCreateSession` HTTP wrapper. `createSessionDependencies(settings)` now
returns `{ authenticate, createForSubmission }` instead of the raw
`SessionHandlerDependencies` containing `createTransaction`, `clock`, `ids`,
and `holdingAccountId`. There is no compatibility wrapper.

API routes await `getSessionDependencies()` and perform the HTTP sequence
directly: authenticate, parse, obtain the submission-scoped use case, invoke
`forBooker`, and map the result or error. The app getter owns initialization and
caching; `createSessionDependencies(settings)` remains a synchronous assembly
function for callers that already have validated settings.
Custom configurations implement `SessionApiDependencies`; their
`createForSubmission` callback constructs the use case with the chosen
transaction, clock, ID generator, and holding account. In-memory tests use
`RequestSessionCreationTransaction(unitOfWork, submission)` in that callback.

`CreateSessions.forBooker(bookerId, booking, config)`, the shared `UnitOfWork`,
and the HTTP contract are unchanged. The creation transaction callback still
exposes only `users.get` and `sessions.save`.
[ADR-0011](../docs/adr/0011-api-routes-invoke-use-cases.md) records this change.

The [HTTP contract](../app/sessions/README.md) documents input and status codes.
[Swagger UI](http://127.0.0.1:3000/api-docs) renders the same transport schemas;
`/api/openapi` serves OpenAPI 3.0.3. The generator is pinned to
`@asteasolutions/zod-to-openapi@7.3.4` for this repository’s Zod 3 version;
upgrade them together in separate work.

Core modules never import this configuration folder, Supabase, or PostgreSQL.
The domain and its complete-User hydration rules are unchanged.
