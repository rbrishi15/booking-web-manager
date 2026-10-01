# ADR-0011: API routes invoke use cases

- Status: Accepted
- Date: 2026-09-30
- Partially supersedes: the session factory output decision in
  [ADR-0001](./0001-use-case-driven-development.md).

The session API previously forwarded requests through a configured HTTP
handler and an app HTTP function before reaching the use case. The API route
now visibly authenticates, parses, obtains a submission-scoped `CreateSessions`
instance, calls `forBooker`, and maps the response. Keeping that short sequence
in one place makes the endpoint easier to follow without moving business rules
out of the core.

`use-case-config` returns the app-owned `SessionApiDependencies` containing
`authenticate` and `createForSubmission`. It selects concrete adapters and
constructs each use case through plain functions and constructors. The API
route consumes those capabilities; `/app` retains validation and HTTP response
helpers, `/lib` owns external integrations and resources, and the core retains
framework-independent workflows and business rules.

Both the earlier delegation and direct invocation satisfy Clean Architecture:
controllers translate HTTP input and invoke use cases, while source dependencies
point inward. This choice reduces indirection for readers; it is not a required
number of files or layers. See Martin's original
[controller explanation](https://blog.cleancoder.com/uncle-bob/2011/11/22/Clean-Architecture.html)
and [Dependency Rule](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html).
Assembly stays near the entry point, following
[Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) and
[Pure DI](https://blog.ploeh.dk/2014/06/10/pure-di/), without a container library.

Lazy dependency initialization remains a deliberate error policy: setup errors
can return the API's opaque JSON 500. The app-owned `getSessionDependencies()`
shares pending and successful initialization within each runtime instance and
clears its cache only when initialization rejects. The route awaits this getter
and owns HTTP error mapping; configuration remains synchronous dependency
assembly. Vercel and Clean Architecture do not require laziness. Warm requests
reuse shared dependencies; each submission gets its own use case and
transaction. Awaiting assembly does not establish database readiness: pool
creation remains independently lazy in infrastructure. HTTP behavior,
replay semantics, domain rules, and persistence schemas are unchanged. See the
[configuration guide](../../use-case-config/README.md) for lifetimes and the
migration from the removed handler factories.
