# /lib

Reusable implementation modules, including infrastructure and integration
adapters. Each module owns a focused responsibility; the directory name alone
does not identify an architectural layer.

## Anti-corruption layers and adapters

An **anti-corruption layer (ACL)** translates another system's data and meaning
into the application's own vocabulary, and translates requests in the other
direction. This keeps provider-specific payloads, statuses and errors out of
the domain and use-case contracts. See the
[anti-corruption layer pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer).

An interface defines the contract; an adapter implements it. An adapter performs
an anti-corruption role when it also translates between the models. A client
wrapper that simply forwards provider objects does not provide that protection.

`/lib/money` contains persistence adapters with anti-corruption behavior, plus
ledger infrastructure and money helpers. Its row, amount and error mappings
protect the application from storage details. The module as a whole has a
broader responsibility than translation; see its
[architectural role](./money/README.md#architectural-role).

## Where should an ACL live?

Neither Clean Architecture nor the ACL pattern requires a `lib` directory.
Names such as `adapters`, `infrastructure` or an integration's own directory
can also express the responsibility. Choose a location that makes ownership,
dependencies and the system being adapted clear.

For this repository:

- Keep the existing ledger implementation in `/lib/money`, as established by
  [the ledger ADR](../docs/adr/0004-append-only-double-entry-ledger.md).
- Keep domain rules and types in `/domain`, and application coordination in
  `/use-cases`. Ports needed by those layers belong with their callers;
  concrete persistence and provider adapters depend on those contracts.
- Put related translations beside their owning adapter. Database column
  mappings, cents codecs and known database-error translations belong with the
  ledger implementation; provider-event translations belong with that provider's
  integration.
- Preserve the existing Stripe integration locations: `/app/wallet`,
  `/app/payouts` and `/app/api/webhooks`. `/lib/money` makes no Stripe calls.
  A generic library folder is not a reason to relocate those integrations.

The current implementation module is [money](./money/README.md). The proposed
system diagram, external API adapters and BCE mapping are in the
[root README](../README.md#architecture-direction-clean-architecture).
