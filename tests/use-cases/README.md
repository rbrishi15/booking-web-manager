# /tests/use-cases

One Vitest file per use case ID from the SRS, named `UC<n>-<seq>-<slug>.test.ts`.
Each starts as `test.todo(...)` — reserve the acceptance criteria as todos
before the feature exists, then fill them in as real tests when you build it.
Keep the UC ID in the file name and the top-level `describe` block; that's
what makes a UC traceable to its test from a commit message, a PR title, or
`git grep UC2-04`.

## Coordinator tests

UC2-05 exercises the production `WithdrawFromSession`, `AcceptReplacement`, and
`ExpireSessionReplacements` coordinators through their `execute` methods. The
[use-case guide](../../use-cases/README.md) describes their inputs, outputs, and
transaction contract. Keep business state transitions in the real domain
objects, with test adapters supplying repositories, the ledger, and UnitOfWork.

The transactional test adapter supplies isolated state, rollback, and replay
semantics to verify orchestration. Its passing tests do not establish production
database isolation, concurrent wallet safety, authentication, notification
delivery, or scheduler integration. Keep production-adapter tests separate when
those adapters are added.

Use explicit Arrange, Act, and Assert phases and scenario names that explain
the trigger and result. Assert observable session, hold, queue, ledger, and
returned-result changes. For failures, assert unchanged persisted state and
ledger history; for replay, assert that the same request does not duplicate
effects and that a changed scope or payload is rejected. Keep prerequisite
transitions visible and use a fixed clock and deterministic IDs.

Use readable session-relative times, following the
[domain time convention](../domain/README.md#time-expressions). Name event times
such as `withdrawalTime`, `acceptanceTime`, and `expiryTime` when a scenario has
several events or reuses a timestamp. Use helpers whose names show unit,
direction, and anchor; keep offsets positive and name exact boundaries and
one-millisecond offsets explicitly. Do not hide a scenario's timing inside a
generic fixture.

UC2-05 expiry tests stop at `FORFEITURE_DUE` and verify that no payout or
forfeiture ledger entry is created. The remaining requirement to credit/pay the
booker belongs to UC2-06 settlement coverage, not an expiry assertion in UC2-05.

Ownership follows the feature directory that implements the use case — see
[CODEOWNERS](../../.github/CODEOWNERS).
