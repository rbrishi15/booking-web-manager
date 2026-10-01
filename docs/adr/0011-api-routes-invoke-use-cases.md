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

`use-case-config` assembles the app-owned `SessionApiDependencies` containing
`authenticate` and `createForSubmission`. With integrations supplied, it
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

The app-owned `getSessionDependencies()` provides the server assembly boundary.
The route awaits it and owns HTTP error mapping; configuration remains
dependency assembly. The getter shares pending and successful initialization
within each runtime instance and clears its cache only when initialization
rejects. This lazy setup is an error policy; Vercel and Clean Architecture do
not require it. Each configured submission gets its own use case and
transaction. Resource policies and database readiness belong to the eventual
infrastructure implementations, not to a required number of application layers.

The current PR delivers this contract with injected-dependency tests while
authentication and persistence integrations remain pending. Its production
default returns `503 SESSION_API_UNAVAILABLE` with
`Session creation is not available yet`; unexpected initialization errors still
return an opaque JSON 500. This availability state leaves the accepted direct
route invocation and inward dependency rules unchanged. Swagger/OpenAPI remain
public, and the configured contract, replay semantics, and domain rules remain
testable without live services. See the
[configuration guide](../../use-case-config/README.md) for integration
requirements, owners, and merge prerequisites.
