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

| Dependency | Contract | Example below | Future server value |
| --- | --- | --- | --- |
| `authenticate` | `(Request) => Promise<UUID \| null>` | Returns a fixture user's ID | Reads the authenticated server session; returns `null` when absent |
| `unitOfWork` | Shared `UnitOfWork` | Existing creation-only in-memory fake | Database adapter with atomic commit, rollback, and replay |
| `clock` | `now(): Date` | Fixed time | Current server time |
| `ids` | `next(): UUID` | Node's `randomUUID` | Cryptographically random UUIDs, including private room tokens |
| `holdingAccountId` | `UUID` | Fixture account ID | Existing platform holding account from validated server configuration |

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

## Complete test example

This uses existing test adapters and fixtures. It calls a configured function
directly and does not require a running HTTP server or a mounted route.

```ts
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { createSessionHandler } from "@/use-case-config/sessions";
import { readyBookerUser } from "@/tests/domain/accounts/user-fixtures";
import { CreateSessionUnitOfWork } from "@/tests/use-cases/support/create-session-unit-of-work";

test("creates one session when the same submission is retried", async () => {
  const bookerId = "11111111-1111-4111-8111-111111111111";
  const unitOfWork = new CreateSessionUnitOfWork([readyBookerUser(bookerId)]);
  const handleRequest = createSessionHandler({
    authenticate: async () => bookerId,
    unitOfWork,
    clock: { now: () => new Date("2030-09-01T00:00:00Z") },
    ids: { next: randomUUID },
    holdingAccountId: "00000000-0000-4000-8000-000000000001",
  });
  const request = () => new Request("https://example.test/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "first-booking-room",
      booking: {
        venueName: "Jurong East Sports Hall",
        region: "West",
        sport: "Badminton",
        startAt: "2030-10-01T10:00:00+08:00",
        endAt: "2030-10-01T12:00:00+08:00",
        totalCostCents: 1001,
      },
      config: { totalSlots: 3, minimumHeadcount: 2 },
    }),
  });

  const response = await handleRequest(request());
  const created = await response.json();
  expect(response.status).toBe(201);
  expect(created.bookingShareCents).toBe(333);
  expect(unitOfWork.requireSession(created.sessionId).bookerId).toBe(bookerId);

  const replay = await handleRequest(request());
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(created);
  expect(unitOfWork.sessions.size).toBe(1);
});
```

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
