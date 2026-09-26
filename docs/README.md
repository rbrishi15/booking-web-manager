# /docs

Requirements, use cases, data dictionary and the class diagram (the SRS) live
here. When behaviour and the SRS disagree, the SRS wins — fix the code or
raise it, don't silently diverge. Use case IDs (`UC1-05`, `UC2-04`) are the
shared vocabulary; reference them in commit messages and PR titles.

The current implementation's [domain UML class diagram](./domain-class-diagram.md)
is available as [PlantUML source](./domain-class-diagram.puml) and a
[scalable SVG](./assets/domain-class-diagram.svg).

Architecture decisions are recorded in [`docs/adr`](./adr):

- [ADR-0001: Use-case-driven development](./adr/0001-use-case-driven-development.md).
- [ADR-0002: Constructor-based domain hydration](./adr/0002-constructor-based-domain-hydration.md).
- [ADR-0003: Aggregate roots and boundaries](./adr/0003-aggregate-roots-and-boundaries.md) — current role routing is defined by ADR-0009.
- [ADR-0004: Participant join and session admission](./adr/0004-participant-join-and-session-admission.md) — admission routing updated by ADR-0007 and ADR-0009.
- [ADR-0005: Domain unit-test structure](./adr/0005-domain-unit-test-structure.md).
- [ADR-0006: Personal replacement reservations — proposed](./adr/0006-personal-replacement-reservations.md).
- [ADR-0007: Participant behavior and the Session roster](./adr/0007-participant-behavior-and-session-roster.md) — callback routing superseded by ADR-0009.
- [ADR-0008: Booker behavior and the Session lifecycle](./adr/0008-booker-behavior-and-session-lifecycle.md) — callback routing superseded by ADR-0009.
- [ADR-0009: Role workflows and Session recording](./adr/0009-role-workflows-and-session-recording.md).

Product discussions awaiting approval:

- [Waitlists and replacements: options, assumptions, and product-owner decisions](./discussions/waitlist-and-replacement-options.md).
