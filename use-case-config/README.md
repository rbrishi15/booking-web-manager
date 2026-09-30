# Use-case configuration

This folder connects the pieces needed to run a use case. For session creation,
[`createSessionHandler`](./sessions.ts) accepts the server dependencies and
returns a `(request: Request) => Promise<Response>` function. Plain functions
and constructors keep the assembly visible.

The configured handler calls the [app HTTP module](../app/sessions/create-session-handler.ts)
to authenticate the request, parse its JSON, invoke the use case, and translate
the result or error into an HTTP response. Configuration supplies a
`createForSubmission` callback that constructs
[`RequestSessionCreationTransaction`](../lib/sessions/request-session-creation-transaction.ts)
and [`CreateSessions`](../use-cases/sessions/CreateSessions.ts) for each parsed
submission. The transaction wrapper delegates to the supplied unit of work.

`SessionConfig` is different: it holds the booker's choices such as capacity and
visibility. This folder configures the dependencies used to carry out those choices.

## Dependencies

| Dependency | Contract | Future server value |
| --- | --- | --- |
| `authenticate` | `(Request) => Promise<UUID \| null>` | Reads the authenticated server session; returns `null` when absent |
| `unitOfWork` | Shared `UnitOfWork` | Database adapter with atomic commit, rollback, and replay |
| `clock` | `now(): Date` | Current server time |
| `ids` | `next(): UUID` | Cryptographically random UUIDs, including private room tokens |
| `holdingAccountId` | `UUID` | Existing platform holding account from validated server configuration |

Production authentication and database adapters have not been implemented.
The final column describes substitutions to supply later; it does not name
available production classes. The handler and business action remain the same
when those dependencies are replaced.

For example, given the same `dependencies` object, replace a fixed test clock
with the real server clock:

```ts
const handleRequest = createSessionHandler({
  ...dependencies,
  clock: { now: () => new Date() },
});
```

## Setup

Supply the dependencies above, then pass the incoming HTTP `Request` to the
configured handler:

```ts
const handleRequest = createSessionHandler(dependencies);
const response = await handleRequest(request);
```

See the [centralized HTTP handler tests](../tests/use-case-config/sessions.test.ts)
for executable examples using fake authentication and the in-memory unit of
work, including creation, retries, and errors.

## Dependency lifetimes

The configured handler and dependencies that hold no request-specific state can
be shared. `authenticate` still examines each Request, and `unitOfWork` opens or
replays each operation. Each parsed submission gets a new transaction wrapper
and `CreateSessions` instance, so its captured retry key cannot leak into a later
submission.

A retry uses the same key and receives the original result, even through a new
handler invocation and when valid booking details have changed. An intended new
session needs a new key. Keys are isolated by use case and authenticated booker.
Failures persist neither a session nor a successful replay result. Production
transaction atomicity and concurrency remain responsibilities of the future
database adapter; the in-memory test does not establish those guarantees.

This outer configuration module may import app handlers, lib adapters, and use
cases. `/use-cases` and `/domain` keep their dependency direction inward and
never import this folder. The [HTTP contract](../app/sessions/README.md) documents
request parsing and response statuses. Mounting a route, integrating production
auth/storage, migrations, OneMap, and UI remain separate work.
