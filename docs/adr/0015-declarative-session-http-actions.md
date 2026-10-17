# ADR-0015: Declarative session HTTP actions

- Status: Accepted
- Date: 2026-10-13
- Partially supersedes: the per-route HTTP orchestration in
  [ADR-0011](./0011-api-routes-invoke-use-cases.md).
- Clarified by: [ADR-0016](./0016-deep-workflows-and-dependency-assembly.md),
  covering complete workflow results and technical endpoint boundaries.

Session routes repeat dependency loading, authentication, input parsing and
error mapping. They now use app-owned action factories, following the existing
`commitmentAction({ parse, run, invalidRequestMessage })` pattern. The route
retains the parser and a `run` callback that visibly invokes its use case;
optional serialization and success status describe its HTTP result. This keeps
the endpoint-specific behavior readable while giving repeated HTTP policy one
implementation.

`createAuthenticatedActions` in
[`app/http/authenticated-action.ts`](../../app/http/authenticated-action.ts) provides
JSON-body and GET actions. Feature wrappers select the dependency getter,
error mapper and success headers. The shared action authenticates before
parsing, validates route parameters through the supplied parser, and keeps
dependencies and actor identity local to each request. Only request-boundary
failures become 400s; initialization, authentication and use-case failures retain
their existing response policy. Public discovery has its own action factory,
with no authentication and the existing initialization, validation, query and
serialization diagnostic stages.

This changes where repeated HTTP steps live, not the dependency direction or
business rules. `/use-case-config` still assembles dependencies and, where needed,
submission-scoped construction callbacks only; it does not return handlers or
invoke use cases. `/app` owns HTTP policy and input validation, `/lib` owns
infrastructure, and the core remains framework-independent. Creation retains
201 and its existing cache behavior; other routes retain their status, caching,
authentication and error contracts, including discovery's safe 500 diagnostics.
