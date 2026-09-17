# /docs

Requirements, use cases, data dictionary and the class diagram (the SRS) live
here. When behaviour and the SRS disagree, the SRS wins — fix the code or
raise it, don't silently diverge. Use case IDs (`UC1-05`, `UC2-04`) are the
shared vocabulary; reference them in commit messages and PR titles.

Architecture decisions are recorded in [`docs/adr`](./adr):

- [ADR-0001: Use-case-driven development](./adr/0001-use-case-driven-development.md).
- [ADR-0002: Constructor-based domain hydration](./adr/0002-constructor-based-domain-hydration.md).
- [ADR-0003: Aggregate roots and boundaries](./adr/0003-aggregate-roots-and-boundaries.md).
- [ADR-0004: Append-only double-entry ledger](./adr/0004-append-only-double-entry-ledger.md).

Per-subsystem design models live in [`docs/design`](./design) — the Lab 3
deliverable for each vertical: design class diagram, persistent data design,
access control, design patterns and traceability.

- [The wallet ledger subsystem](./design/ledger-subsystem.md) — Harrison.
