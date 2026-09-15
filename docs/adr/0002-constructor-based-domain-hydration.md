# ADR-0002: Constructor-based domain hydration

- Status: Accepted
- Date: 2026-09-15

## Context

Domain classes previously exposed `snapshot()` and `reconstitute()` methods and
parallel `*Snapshot` types. Those representations also appeared inside ordinary
state transitions and defensive copies. Simple identities such as `Wallet` had
separate creation and reconstruction methods that performed the same work.

The application uses state-based persistence contracts and has no domain-event
replay mechanism. Snapshots can be used without event sourcing, but this
application does not need a separate domain serialization API: adapters can
construct domain objects from existing state through normal constructors.

This decision complements [ADR-0001](./0001-use-case-driven-development.md):
business rules remain in the domain, and infrastructure connects through ports.

## Decision

### Constructors accept valid domain state

Hydration means constructing objects from existing state. Domain entities and
structured values have public constructors with named arguments. Constructors
validate state invariants, copy mutable inputs, and accept valid existing
lifecycle states, including inactive users, completed payouts, and ended
sessions. Invalid state fails validation regardless of its source.

Nested arguments are domain objects: a `Session` takes a `Booking` and
`Participation` objects; a `Participation` takes a `FundHold`; a `User` takes an
optional `PayoutAccount`. Constructor argument types describe domain values,
not database rows or a parallel persistence representation.

```ts
const wallet = new Wallet({ walletId, userId });

const existingUser = new User({
  userId,
  email: null,
  accountStatus: "INACTIVE",
  preferredSports: new Set(),
  preferredRegions: new Set(),
  payoutAccount, // An already constructed PayoutAccount, if present.
});
```

### Factories express creation rules

Keep factories where creation applies business rules, calculates values, or
sets lifecycle defaults. Registration starts an active user; session creation
requires an eligible booker and an upcoming booking; payout creation calculates
the settlement amount. Factories invoke validated constructors.

```ts
const registeredUser = User.create({ userId, email });
```

Hydration calls constructors without repeating creation workflows, resetting
lifecycle fields, generating replacement identities or timestamps, or producing
external effects. Constructors and factories perform no database or network IO.
Classes whose factories only forwarded validated arguments use constructors
directly. Existing value-object factories such as `Money.fromCents()` continue
to express their units and meaning.

### Adapters own storage mapping

Repository adapters map database column names, JSON, stored timestamps, and
primitives to domain values. They assemble children before calling parent
constructors. For writes, they map public domain properties to storage. These
mappings and storage schemas stay outside the domain.

`Repository<T>` continues to load and save domain objects. Domain classes expose
behavior and ordinary properties, with no persistence-specific `snapshot()`,
`reconstitute()`, `toPersistence()`, or equivalent whole-object conversion API.
This decision establishes the convention for future adapters; it does not add
an adapter implementation.

### Encapsulation and atomic commands remain domain concerns

Immutable children can be shared directly. Constructors and getters copy mutable
dates, collection containers, and settlement data so callers cannot change
aggregate state through aliases. Aggregate lifecycle changes pass through domain
commands, and immutable child transitions return new instances.

Commands calculate and validate proposed changes before applying them. Settlement
preparation and completion construct their results before updating the session,
so a failure leaves existing state unchanged without a serialization-based
rollback mechanism. Database transaction rollback remains the adapter's concern.

## Consequences

- Domain code has one validated construction path and no parallel snapshot API.
- Adapters perform explicit mapping and must supply coherent domain state;
  invalid stored state fails constructor validation instead of being silently
  repaired or reset through creation defaults.
- Constructor changes may require corresponding adapter and fixture updates.
  Public constructors validate state, not actor authorization; application
  workflows still invoke the appropriate creation factories and commands.
- Tests construct existing states directly, assert public values and behavior,
  and verify mutation isolation and failed-command atomicity.
- Any future event-sourcing architecture or domain-event replay mechanism
  requires a separate architectural decision.
