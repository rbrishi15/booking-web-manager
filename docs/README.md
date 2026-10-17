# /docs

Requirements, use cases, data dictionary and the class diagram (the SRS) live
here. When behaviour and the SRS disagree, the SRS wins — fix the code or
raise it, don't silently diverge. Use case IDs (`UC1-05`, `UC2-04`) are the
shared vocabulary; reference them in commit messages and PR titles.

The current implementation's [domain UML class diagram](./domain-class-diagram.md)
is available as [PlantUML source](./domain-class-diagram.puml) and a
[scalable SVG](./assets/domain-class-diagram.svg).

Architecture decisions are recorded in [`docs/adr`](./adr):

- [ADR-0001: Use-case-driven development](./adr/0001-use-case-driven-development.md) — session factory output superseded by ADR-0011.
- [ADR-0002: Constructor-based domain hydration](./adr/0002-constructor-based-domain-hydration.md).
- [ADR-0003: Aggregate roots and boundaries](./adr/0003-aggregate-roots-and-boundaries.md) — current role routing is defined by ADR-0009.
- [ADR-0004: Participant join and session admission](./adr/0004-participant-join-and-session-admission.md) — admission routing updated by ADR-0007 and ADR-0009.
- [ADR-0004: Append-only double-entry ledger](./adr/0004-append-only-double-entry-ledger.md) — independently recorded with the same historical number; the filename distinguishes this storage decision from participant admission.
- [ADR-0005: Domain unit-test structure](./adr/0005-domain-unit-test-structure.md).
- [ADR-0006: Named personal replacements and the session waitlist](./adr/0006-personal-replacement-reservations.md) — confirmed on 27 September 2026: directly invite one user who must explicitly accept, or open the place to the groups/public waitlist, with no switching after withdrawal.
- [ADR-0007: Participant behavior and the Session roster](./adr/0007-participant-behavior-and-session-roster.md) — callback routing superseded by ADR-0009.
- [ADR-0008: Booker behavior and the Session lifecycle](./adr/0008-booker-behavior-and-session-lifecycle.md) — callback routing superseded by ADR-0009.
- [ADR-0009: Role workflows and Session recording](./adr/0009-role-workflows-and-session-recording.md).
- [ADR-0010: Session's participant list](./adr/0010-session-participant-list.md).
- [ADR-0011: API routes invoke use cases](./adr/0011-api-routes-invoke-use-cases.md) — repeated session HTTP orchestration superseded by ADR-0015; route-visible invocation and dependency-only assembly remain.
- [ADR-0012: Booker-selected session pricing](./adr/0012-booker-selected-session-pricing.md).
- [ADR-0013: Cancellation preserves terminal participations](./adr/0013-cancellation-preserves-terminal-participations.md).
- [ADR-0014: Account policies and transaction guards](./adr/0014-account-policies-and-transaction-guards.md) — profile policy exception to ADR-0003, account deactivation, group transaction guards, and dependency enforcement.
- [ADR-0015: Declarative session HTTP actions](./adr/0015-declarative-session-http-actions.md).
- [ADR-0016: Deep workflows and dependency assembly](./adr/0016-deep-workflows-and-dependency-assembly.md) — complete application results, construction-only configuration, app serialization, and technical endpoint boundaries.

Product decisions and remaining discussion:

- [Waitlists and replacements: confirmed scope, historical options, and remaining policy questions](./discussions/waitlist-and-replacement-options.md). The waitlist and fixed either/or departure choice are confirmed; unrelated financial and rejoining proposals remain under review.
