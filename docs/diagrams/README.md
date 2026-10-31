# Diagrams

Every project diagram is listed here: use-case, class, sequence, state,
dialog-map, architecture, database and control-flow diagrams, including the
figures in the SRS and lab reports. When you need a diagram for a report, take
it from here so the report and the repository show the same thing.

## Adding or updating a diagram

1. **Put it in a type folder under `docs/diagrams/`.** Create the folder if it
   does not exist yet.

   | Folder | Diagram type |
   | --- | --- |
   | `use-case/` | Use-case diagrams |
   | `class/` | Class diagrams |
   | `sequence/` | Sequence diagrams |
   | `state/` | State machine diagrams |
   | `dialog-map/` | The UI dialog map |
   | `architecture/` | Architecture and component diagrams |
   | `database/` | Database and ER diagrams |
   | `cfg/` | Control-flow graphs for white-box testing |

2. **Commit the editable source next to its export, with the same name.** For
   example, `sequence/uc2-04-commit-to-session.drawio` beside
   `uc2-04-commit-to-session.png`. Sources can be draw.io (`.drawio`),
   PlantUML (`.puml`), Mermaid (`.mmd`) or Visual Paradigm (`.vpp`). Commit an
   image without a source only when the source is truly unavailable, and say
   so in the table below.
3. **Name files in kebab-case, starting with the use case ID** when the diagram
   belongs to one: `uc1-01-register-user.puml`, `uc2-session-management.png`.
4. **Add or update its row in the table below in the same PR**, and request
   review from the area owner.
5. **Update the diagram in the same PR as the behaviour it shows.** Regenerate
   its exports at the same time.

These are not diagrams and stay where they are:

- UI screenshots: `docs/assets/<feature>/`
- Test evidence: `docs/testing/`

## All diagrams

| Diagram | Type | Area owner | Source | Export | Used in |
| --- | --- | --- | --- | --- | --- |
| UC2 session management | Use case | Yajie | Not in repo (SRS) | [uc2-session-management.png](./use-case/uc2-session-management.png) | SRS, [Lab 3](../../lab3/README.md) |
| UC1 user and wallet management | Use case | Harrison | Not in repo (SRS) | [uc1-user-and-wallet-management.png](./use-case/uc1-user-and-wallet-management.png) | SRS |
| Dialog map | Dialog map | Yajie | [dialog-map/*.drawio](./dialog-map/README.md) | [PNG](./dialog-map/dialog-map.png), [SVG](./dialog-map/dialog-map.svg), [PDF](./dialog-map/dialog-map.pdf) | [Lab 3](../../lab3/README.md) |
| UC1-06 Groups experience (current UI) | Dialog map | Joseph | [DOT](./dialog-map/uc1-06-groups-experience.dot) | [SVG](./dialog-map/uc1-06-groups-experience.svg) | [Groups](../../app/groups/README.md), supersedes the Lab 3 snapshot's group creation transition |
| Domain class diagram (overview) | Class | Rishi | [domain-class-diagram.puml](../domain-class-diagram.puml) | [SVG](../assets/domain-class-diagram.svg), [PNG](../assets/domain-class-diagram.png) | [Domain class diagram](../domain-class-diagram.md) |
| Domain: accounts and groups | Class | Rishi | [domain-accounts.puml](./domain-accounts.puml) | [SVG](../assets/domain-accounts.svg) | [Domain class diagram](../domain-class-diagram.md) |
| Domain: sessions | Class | Rishi | [domain-sessions.puml](./domain-sessions.puml) | [SVG](../assets/domain-sessions.svg) | [Domain class diagram](../domain-class-diagram.md) |
| Domain: settlement | Class | Rishi | [domain-settlement.puml](./domain-settlement.puml) | [SVG](../assets/domain-settlement.svg) | [Domain class diagram](../domain-class-diagram.md) |
| Domain: ledger | Class | Rishi | [domain-ledger.puml](./domain-ledger.puml) | [SVG](../assets/domain-ledger.svg) | [Domain class diagram](../domain-class-diagram.md) |
| SRS entity model A: Accounts and regular groups | Class | Rishi | Not in repo (SRS) | [srs-entity-model-a.png](./class/srs-entity-model-a.png) | SRS |
| SRS entity model B: Session aggregate and role workflows | Class | Rishi | Not in repo (SRS) | [srs-entity-model-b.png](./class/srs-entity-model-b.png) | SRS |
| SRS entity model C: Participation, fund holds and reliability | Class | Rishi | Not in repo (SRS) | [srs-entity-model-c.png](./class/srs-entity-model-c.png) | SRS |
| SRS entity model D: Payout attempts and settlement snapshots | Class | Rishi | Not in repo (SRS) | [srs-entity-model-d.png](./class/srs-entity-model-d.png) | SRS |
| SRS entity model E: Ledger, balance queries and supporting values | Class | Rishi | Not in repo (SRS) | [srs-entity-model-e.png](./class/srs-entity-model-e.png) | SRS |
| ECB layered overview (boundary and control classes) | Class | Team (SRS) | Not in repo (SRS) | [srs-ecb-layered-overview.png](./class/srs-ecb-layered-overview.png) | SRS |
| Runtime architecture and external services (Figure D.1) | Architecture | Rishi | Not in repo (SRS) | [srs-runtime-architecture.png](./architecture/srs-runtime-architecture.png) | SRS |
| Session use-case context | Use case | Neoh | Not in repo | [session-use-case-context.png](../adr/assets/session-use-case-context.png) | [ADR-0001](../adr/0001-use-case-driven-development.md) |
| Participant states (product-owner reference) | State | Neoh | Not in repo | [PNG](../assets/participant-state-diagram-product-owner-reference.png) | [Waitlist and replacement options](../discussions/waitlist-and-replacement-options.md) |
| `parseTopUp` control-flow graph | Control flow | Harrison | Not in repo | [cfg-parse-top-up.png](./cfg/cfg-parse-top-up.png) | Not linked yet |
| Account white-box control-flow graphs (5) | Control flow | Joseph | [figures/*.dot](../testing/account-testing/figures/) | [figures/*-cfg.png](../testing/account-testing/figures/) | [Account testing](../testing/account-testing/README.md) |
| Session white-box control-flow graphs (5) | Control flow | Neoh | [figures/*.dot](../testing/session-testing/figures/) | [figures/*-cfg.png](../testing/session-testing/figures/) | [Session testing](../testing/session-testing/README.md) |

### Diagrams written in Markdown

These Mermaid diagrams are drawn in the page that uses them. GitHub renders
them in place, so the Markdown block is both the source and the export.

| Diagram | Type | Area owner | Location |
| --- | --- | --- | --- |
| Request and external integration flow | Architecture | Rishi | [README.md](../../README.md) |
| Domain hydration and sources of truth | Architecture | Rishi | [ADR-0002](../adr/0002-constructor-based-domain-hydration.md) |
| Participant join through the unit of work | Sequence | Rishi | [ADR-0004](../adr/0004-participant-join-and-session-admission.md) |
| Payout request idempotency | Architecture | Rishi | [ADR-0020](../adr/0020-payout-request-idempotency.md) |
| Hold state machine | State | Harrison | [Ledger subsystem §2](../design/ledger-subsystem.md) |
| Ledger design class diagram | Class | Harrison | [Ledger subsystem §3](../design/ledger-subsystem.md) |
| Ledger entity relationships | Database | Harrison | [Ledger subsystem §4](../design/ledger-subsystem.md) |

### Diagrams not yet moved here

The domain class diagram images, the ADR and discussion images, and the
white-box control-flow graphs stay where they are for now. The class diagrams
are being edited in open PRs, and the control-flow graphs are generated into
their test reports' `figures/` folders. Their owners can move them into a type
folder the next time they change them, updating this table and the pages that
link to them.

### Missing from the repository

SRS and lab-report diagrams that exist only in the report, such as sequence
diagrams, belong here too. Add each one, with its source, to the
folder for its type.

The SRS images marked "Not in repo (SRS)" were copied from the report at the
report's resolution. Whoever has the original draw.io, PlantUML or Visual
Paradigm file should commit it beside the image, re-export at full resolution,
and update the row. The SRS entity models A–E show the same domain as the
domain class diagrams above, split into five views for the report.
