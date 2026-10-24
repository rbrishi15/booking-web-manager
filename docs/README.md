# /docs

Requirements, use cases, data dictionary and the class diagram (the SRS) live
here. When behaviour and the SRS disagree, the SRS wins — fix the code or
raise it, don't silently diverge. Use case IDs (`UC1-05`, `UC2-04`) are the
shared vocabulary; reference them in commit messages and PR titles.

The current implementation's [domain UML class diagram](./domain-class-diagram.md)
is available as [PlantUML source](./domain-class-diagram.puml) and a
[scalable SVG](./assets/domain-class-diagram.svg).

[Session testing](./testing/session-testing/README.md) covers UC2-01, UC2-02
and UC2-03a/b/c with an editable Word report, black-box cases, white-box
control-flow diagrams and recorded execution evidence.

Architecture decisions are recorded in [`docs/adr`](./adr):

- [ADR-0001: Use-case-driven development](./adr/0001-use-case-driven-development.md) — session factory output superseded by ADR-0011.
- [ADR-0002: Constructor-based domain hydration](./adr/0002-constructor-based-domain-hydration.md).
- [ADR-0003: Aggregate roots and boundaries](./adr/0003-aggregate-roots-and-boundaries.md) — current role routing is defined by ADR-0009; members leaving a group is defined by ADR-0017.
- [ADR-0004: Participant join and session admission](./adr/0004-participant-join-and-session-admission.md) — admission routing updated by ADR-0007 and ADR-0009.
- [ADR-0004: Append-only double-entry ledger](./adr/0004-append-only-double-entry-ledger.md) — independently recorded with the same historical number; the filename distinguishes this storage decision from participant admission.
- [ADR-0005: Domain unit-test structure](./adr/0005-domain-unit-test-structure.md) — phase-comment requirement superseded by ADR-0018.
- [ADR-0006: Named personal replacements and the session waitlist](./adr/0006-personal-replacement-reservations.md) — confirmed on 27 September 2026: directly invite one user who must explicitly accept, or open the place to the groups/public waitlist, with no switching after withdrawal.
- [ADR-0007: Participant behavior and the Session roster](./adr/0007-participant-behavior-and-session-roster.md) — callback routing superseded by ADR-0009.
- [ADR-0008: Booker behavior and the Session lifecycle](./adr/0008-booker-behavior-and-session-lifecycle.md) — callback routing superseded by ADR-0009.
- [ADR-0009: Role workflows and Session recording](./adr/0009-role-workflows-and-session-recording.md).
- [ADR-0010: Session's participant list](./adr/0010-session-participant-list.md).
- [ADR-0011: API routes invoke use cases](./adr/0011-api-routes-invoke-use-cases.md) — repeated session HTTP orchestration superseded by ADR-0015; route-visible invocation and dependency-only assembly remain.
- [ADR-0012: Booker-selected session pricing](./adr/0012-booker-selected-session-pricing.md).
- [ADR-0013: Cancellation preserves terminal participations](./adr/0013-cancellation-preserves-terminal-participations.md).
- [ADR-0014: Account policies and transaction guards](./adr/0014-account-policies-and-transaction-guards.md) — profile policy exception to ADR-0003, account deactivation, group transaction guards, and dependency enforcement; the profile write also carries the user ID under ADR-0021.
- [ADR-0015: Declarative session HTTP actions](./adr/0015-declarative-session-http-actions.md).
- [ADR-0016: Deep workflows and dependency assembly](./adr/0016-deep-workflows-and-dependency-assembly.md) — complete application results, construction-only configuration, app serialization, and technical endpoint boundaries.
- [ADR-0017: Members leave regular groups through RegularGroup](./adr/0017-members-leave-regular-groups.md) — a member may leave on their own; the owner cannot leave and archives the group instead.
- [ADR-0018: Request-bound HTTP session-creation retries](./adr/0018-request-bound-session-creation-retries.md) — adoption proposed pending session-owner and ledger review; strict HTTP payload comparison, legacy replay compatibility and coordinated deployment cutover.
- [ADR-0018: Readable domain tests and execution evidence](./adr/0018-domain-test-input-oracle-log.md) — supported public contracts, observable outcomes, and readable behavior groups, plus dated assertion-verified evidence; table layout superseded by ADR-0019.
- [ADR-0019: Domain result tables follow the lecture format](./adr/0019-domain-result-table-layout.md) — individual input columns, Expected Result and Test Result, with source links on the first input value and execution counts above each table.
- [ADR-0020: Payout request idempotency belongs to application transactions](./adr/0020-payout-request-idempotency.md) — supersedes only payout request-key ownership in ADRs 0003, 0008 and 0009; terminal receipts prevent payment redispatch.
- [ADR-0021: User IDs for finding players](./adr/0021-user-ids-for-finding-players.md) — a unique, changeable, Telegram-style user ID on every active account: chosen at sign-up, generated from the name for existing accounts, editable in Edit profile, freed on deletion, and found only by exact signed-in lookup.

Product decisions and remaining discussion:

- [Waitlists and replacements: confirmed scope, historical options, and remaining policy questions](./discussions/waitlist-and-replacement-options.md). The waitlist and fixed either/or departure choice are confirmed; unrelated financial and rejoining proposals remain under review.
