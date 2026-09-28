# Use cases

This layer coordinates application workflows through domain roles and transaction
ports. It imports no HTTP framework, database client, or payment-provider SDK.
Business invariants stay in [the domain](../domain/README.md); coordinators load
authoritative state, invoke its public behavior, and commit the resulting state
and ledger instructions together.

## UC2-05: withdrawal and replacement

The production coordinators live in `use-cases/sessions`:

| Coordinator operation | Input | Result |
| --- | --- | --- |
| [WithdrawFromSession.withdrawAndInvite](./sessions/WithdrawFromSession.ts) | One `replacementInviteeId`, then a `WithdrawFromSessionRequest` | `kind: "REFUNDED"` or `"AWAITING_REPLACEMENT"`, with `participationId` |
| [WithdrawFromSession.withdrawAndOpenToWaitlist](./sessions/WithdrawFromSession.ts) | A `WithdrawFromSessionRequest` | `kind: "REFUNDED"` or `"AWAITING_REPLACEMENT"`, with `participationId` |
| [AcceptReplacement.execute](./sessions/AcceptReplacement.ts) | `actorId`, `sessionId`, `idempotencyKey` | `kind: "COMMITTED"`, with `participationId` and an optional `refundedParticipationId` |
| [ExpireSessionReplacements.execute](./sessions/ExpireSessionReplacements.ts) | `sessionId`, `idempotencyKey` | `expiredParticipationIds` |

The classes and request/command/result types are exported from
[sessions/index.ts](./sessions/index.ts). `WithdrawFromSessionRequest` contains
only the authenticated actor, session, and caller-supplied idempotency key:

```ts
const withdrawal = new WithdrawFromSession(dependencies);
const benLeaving: WithdrawFromSessionRequest = {
  actorId: "ben",
  sessionId: "s",
  idempotencyKey: "ben-withdrawal",
};

await withdrawal.withdrawAndInvite("cara", benLeaving);
```

For a waitlist withdrawal, call `withdrawal.withdrawAndOpenToWaitlist(benLeaving)`.
Each method withdraws the participant and records that fixed choice. Both share
one transaction implementation, retaining the existing private mode-based
request identity for replay. The public withdrawal interface has no `execute`
method or mode selector.

Actor IDs must come from a trusted authentication boundary. Callers do not
supply participation IDs, balances, hold IDs, timestamps, or ledger instructions.
The coordinators obtain authoritative records through the transaction, use the
injected clock and ID generator where needed, and enter actor workflows through
the loaded user's Participant role.

Withdrawal records a fixed either/or choice. `DIRECT_INVITE` reserves that one
seat for one user ID and requires the recipient's explicit `AcceptReplacement`
action. It cannot later switch to the waitlist. An `OPEN_SLOT` withdrawal
immediately processes the FIFO waitlist while unreserved vacancies remain.
Acceptance also processes any remaining ordinary vacancies. A queue head with
a pending personal invitation blocks ordinary promotion until they explicitly
respond; neither coordinator implicitly accepts that invitation or skips that
head to admit another waiter. Domain promotion may skip an ineligible ordinary
waiter and continue to the next person. The withdrawal result reflects the final
state after this processing: a late open-slot withdrawal can already be
`REFUNDED` if a waiter funds that place in the same transaction.

A successful replacement funds its own booking share and refunds its specific
late-withdrawing inviter. An early withdrawal has already been refunded, so
acceptance does not refund it twice. Ordinary promotion retains the domain's
access, eligibility, funding, and oldest-eligible-open-withdrawal rules.

Expiry is allowed only at or after session start. Before start it rejects with
`INVALID_STATE` inside the unit of work; that unsuccessful key remains retryable
at start. Expiry marks unmatched replacement holds `FORFEITURE_DUE` and saves
the session. It appends no ledger entry and does not pay the booker. Ledger
forfeiture and booker payout remain part of **UC2-06 settlement**, whose
application integration is still outstanding.

## Transaction contract

Shared interfaces live in [shared/contracts.ts](./shared/contracts.ts), with
dependencies in [shared/dependencies.ts](./shared/dependencies.ts). Coordinators
depend on `UnitOfWork`, `Clock`, and `IdGenerator` as needed. A `DomainTransaction`
supplies aggregate repositories and ledger/intent ports; these workflows use
its authoritative user and session repositories and ledger writer.

`UnitOfWork.execute` receives a `UnitOfWorkRequest` descriptor containing
`idempotencyKey`, `scope`, and `request`. UC2-05 uses these scopes:

- `UC2-05:withdraw`
- `UC2-05:accept-replacement`
- `UC2-05:expire-replacements`

Replaying an existing key requires the same scope and canonical request payload;
object property order does not change request identity. The payload contains
caller intent, excluding generated IDs and execution time. The adapter returns
the committed result without invoking the workflow again or repeating mutations
or ledger writes. Results must survive a JSON round trip. Reusing a key for
another scope or payload must fail. Failed work must roll back session changes,
ledger writes, and idempotency state so a retry can
run again. Adapters must provide a consistent transaction view, observe their
own writes when reloading users, serialize concurrent uses of the same key,
isolate tentative objects from committed state, and protect concurrent funds
and capacity.

The full withdrawal/acceptance and resulting waitlist processing belong to one
transaction. A later repository or ledger failure must undo earlier successful
domain changes from that execution. Domain atomicity alone cannot provide this
cross-operation rollback.

## Integration status

The coordinators and shared contracts are implemented. The transactional test
adapter under [tests/use-cases](../tests/use-cases/README.md) demonstrates their
orchestration, rollback, and replay behavior. It is not a production database
adapter and does not prove database isolation or concurrent overspending safety.

The existing [LedgerUnitOfWork](../lib/money/ledger-unit-of-work.ts) covers only
the ledger portion of a transaction. It stores the supplied scope but computes
its fingerprint from the request alone; the
[idempotency store](../lib/money/idempotency.ts) currently compares that
fingerprint without comparing scope. A future full application adapter must
bind both scope and canonical request into the fingerprint, or compare scope
explicitly. The similar descriptor shape is not a complete adapter between
these interfaces.

No production application `UnitOfWork`, session repository, authenticated route,
departure-choice UI, invitation delivery, or expiry scheduler is added here.
Those integrations must honor the transaction contract before these workflows
can run against production state. External notifications and payouts must not
be sent from inside the database transaction.
