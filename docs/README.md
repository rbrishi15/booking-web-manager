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
- [ADR-0003: Aggregate roots and boundaries](./adr/0003-aggregate-roots-and-boundaries.md).
- [ADR-0004: Participant join and session admission](./adr/0004-participant-join-and-session-admission.md).
- [ADR-0005: Domain unit-test structure](./adr/0005-domain-unit-test-structure.md).

Product discussions awaiting approval:

- [Waitlists and replacements: options, assumptions, and product-owner decisions](./discussions/waitlist-and-replacement-options.md).
