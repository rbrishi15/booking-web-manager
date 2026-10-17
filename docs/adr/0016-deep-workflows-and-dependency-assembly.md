# ADR-0016: Deep workflows and dependency assembly

- Status: Accepted
- Date: 2026-10-17
- Clarifies: [ADR-0001](./0001-use-case-driven-development.md),
  [ADR-0011](./0011-api-routes-invoke-use-cases.md), and
  [ADR-0015](./0015-declarative-session-http-actions.md).
- Replaces: the configuration guide's obsolete universal SERIALIZABLE requirement
  with the merged lifecycle-writer contract described below.

Wallet configuration had accumulated SQL, database-row translation and top-up
orchestration, while the hosted-session route combined two application reads.
Those boundaries made callers understand implementation steps that belong
behind a capability. Keep application workflows in `/use-cases`, persistence
and provider translation in adapters, and construction in `/use-case-config`.

A use-case method expresses a complete business action or coherent query. It
owns loading, authorization through domain policy, sequencing and transactional
coordination as needed, returning application-owned values through a small
interface. For example, `ListHostedSessions.forBooker` returns upcoming sessions
and sessions awaiting attendance from one account check and transaction; callers
do not assemble that overview from separate workflow calls. A small read module
can still be useful when it owns a stable query contract and time boundary;
module depth is not a minimum line count or a reason to add pass-through classes.

Core-owned ports describe capabilities in application terms. Adapters own SQL,
provider payloads, persistence codecs and transport-specific errors. Use cases
return domain/application values, including `Date` values; `/app` owns HTTP
validation, pagination cursors where already specified, ISO serialization,
status codes and error responses. Core modules remain independent of app,
configuration, infrastructure and framework packages.

Configuration selects and constructs adapters and use cases, returning app-owned
dependencies. It may use app-owned settings readers and unavailable capability
factories. Runtime queries, row mapping, workflow calls, HTTP handlers and
request processing belong in the appropriate modules rather than assembly
closures. A stateless use case can be reused with shared infrastructure; a use
case or transaction capturing submission metadata is constructed per submission.
Authenticated identities, input and mutable transaction state stay request-local.

API routes retain a visible use-case call, usually in an app-owned action's
`run` callback. Technical endpoints can invoke a purpose-built adapter directly:
venue lookup, push subscription registration, Stripe event verification and
OpenAPI publication do not need empty use-case wrappers. Their HTTP policy stays
in `/app`, their external integrations stay in adapters, and business workflows
they trigger still enter the appropriate application capability. Stripe adapters
retain the existing permitted locations in `/app/wallet`, `/app/payouts`, and
`/app/api/webhooks`.

Review interface depth through caller behavior: a caller supplies the intended
action and consumes its result without coordinating repositories, financial
effects, or separate reads for one promised result. Lint enforces dependency
direction in core imports and rejects direct `.query`, `.from` and `.rpc`
persistence calls in configuration, including literal computed properties.
These targeted checks do not prove module depth; interface review and behavioral
and transaction tests establish the workflow guarantees.

Session transaction adapters own their isolation and replay behavior. Management,
cancellation and removal retain SERIALIZABLE with bounded whole-transaction
retries. [PR #45](https://github.com/rbrishi15/booking-web-manager/pull/45) adopted
READ COMMITTED for commitment workflows because the twenty-request/eight-slot
race exhausted three SERIALIZABLE attempts under contention. Mixed writers must
lock the parent Session row before loading its children and update the parent
when persisting lifecycle changes. A waiting READ COMMITTED operation then loads
the committed children; a stale SERIALIZABLE operation retries after the parent
changes. Ledger constraints and wallet locks continue to protect funds.
Child-only writes and arbitrary lower-isolation SQL do not meet this contract.
Acceptance requires races between the real production adapters, including
commitment versus visibility, cancellation and removal; synthetic writers alone
do not establish that integration guarantee. The
[mixed-isolation integration suite](../../tests/integration/session-mixed-isolation.test.ts)
exercises those pairs on the disposable database stack; validation results must
record whether that suite actually ran.
