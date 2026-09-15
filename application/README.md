# Application boundary

The application layer contains framework-independent coordinators. A coordinator
loads aggregates and authoritative eligibility/balance facts, invokes a domain
command, and asks a transaction-scoped `UnitOfWork` to save aggregate snapshots,
append ledger instructions, and create durable payout-request intents atomically.

`SessionApplicationService.requestSettlement` uses the booker's completed payout
account as the direct external destination. Provider delivery happens later from
the durable intent; no provider call belongs inside the database transaction.
`completePayout` and `failPayout` accept callbacks for the matching payout attempt
only, so duplicate callbacks are harmless and stale/conflicting callbacks cannot
settle another attempt.

Repositories, ledger adapters, intent dispatchers, payment providers, HTTP
handlers, and schedulers implement these ports elsewhere. This layer contains no
withdrawal, admission, attendance, or settlement policy; those decisions remain
on the aggregate roots.
