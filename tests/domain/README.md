# Domain unit tests

Domain tests document the behavior of entities and value objects through their
public APIs. For new and refactored tests, follow the unit-test style in
[SC2002-Project](https://github.com/liang799/SC2002-Project), particularly
[HitPointsTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/HitPointsTest.java),
[CombatantTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/CombatantTest.java),
and [SpecialSkillTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/SpecialSkillTest.java).

## Structure and naming

- Use a file named after the entity or value object, with one top-level
  `describe`. Keep smaller suites flat, with tests ordered by method.
- Focused behavior files for the same entity may remain separate, such as
  Money arithmetic, Session admission, reliability history, and User related
  data. Each file still tests one entity and names its top-level `describe`
  after that entity. Separate suites that mix different entities.
- Larger entities may use one additional level of `describe` groups for related
  behaviors, such as construction, profile changes, payout setup, and
  deactivation. Order tests by method within each group, include related getters,
  and avoid deeper nesting or shared setup hooks.
- Split files when responsibilities, fixtures, dependencies, or ownership warrant
  it. Line count alone is not a reason to split a cohesive entity's tests.
- Name each test `method_WhenCondition_ExpectedResult`. Use `constructor` for
  construction and the property name for a getter. Use `test` consistently.
- Give each test one observable domain behavior. Arrange prerequisite transitions
  before exercising that behavior; split cases that independently check joining,
  withdrawal, promotion, or payout completion.
- A domain unit test may use real collaborating entities and value objects.
  Test the subject's public behavior without replacing those collaborators with
  mocks merely to reduce the number of objects in the test.
- Prefer explicitly named tests over field-driven tables so each business rule
  and its important inputs are visible without expanding a table or helper.

## Writing a scenario

Use `// Arrange`, `// Act`, and `// Assert` comments in new and refactored tests,
with blank lines between the phases:

- **Arrange:** create the subject, inputs, and starting state for the scenario.
- **Act:** perform the behavior named by the test and capture its result.
- **Assert:** check the result and relevant observable state.

Use one sequence of these phases, rather than alternating action and assertion
sections. A focused idempotency test may repeat the same operation in Act.
For a retry test, the previous attempt establishes the starting state and Act
performs the retry. If a scenario separately verifies rejection atomicity and
successful recovery, preserve those checks in separate tests.
When that starting state requires an earlier rejection, a direct `toThrow`
assertion in Arrange may establish the precondition; assertions about the
rejection's effects belong in its dedicated failure test.

Name observed results after what they represent, then assert concrete values.

```ts
test("completeSetup_WhenSetupIsPending_ReturnsCompletedCopy", () => {
  // Arrange
  const pendingAccount = PayoutAccount.create({
    payoutAccountId: "account",
    userId: "owner",
    providerAccountReference: "provider",
  });

  // Act
  const completedAccount = pendingAccount.completeSetup("bank");

  // Assert
  expect(pendingAccount.setupStatus).toBe("PENDING");
  expect(completedAccount).not.toBe(pendingAccount);
  expect(completedAccount.setupStatus).toBe("COMPLETE");
  expect(completedAccount.bankAccountReference).toBe("bank");
});
```

Use fresh objects for independent scenarios. Assert rejections directly with
`expect(() => action()).toThrow(expect.objectContaining({ code: "..." }))`.
Label this combined phase `// Act & Assert`, since the assertion executes the
action. Do not introduce error-capture helpers just to separate those phases.
Run the assertion while the subject is in the state named by the test; do not
save an action callback and invoke it after subsequent state changes. When
atomicity matters, also assert that rejection leaves state unchanged.

Reuse fixtures for routine defaults, but keep scenario-specific inputs and
transitions in the test. Put small local helper functions below the tests.
Use descriptive names for people and pass relevant funds directly to the user
fixture, keeping routine wallet construction inside the fixture:

```ts
const alice = createTestUser({ userId: "alice", availableFundsCents: 500 });
```

Keep explicit wallet and transaction-history setup when the history itself is
part of the behavior under test, such as balance derivation or hydration.

Use `createTestSession` for routine starting state; it builds that state through
validated constructors:

```ts
const bookingSession = createTestSession({
  totalSlots: 2,
  committedUserIds: ["alice", "ben"],
  waitlistedUserIds: ["cara"],
});
```

For payout callback and reconstruction tests, use `pendingPayoutDetails` to
declare an attendance-verified session with held shares and a pending payout.
Use `verifiedParticipation` for individual attended or absent participation
records. These fixtures construct valid state directly; they do not run Booker
workflows or calculate which shares production code should release or forfeit.
Keep unusual attendance, withdrawal times, invalid fields, and retry identities
explicit in the scenario instead of adding a general-purpose state builder.

```ts
test("completeSettlement_WhenPayoutIsPending_ReleasesHeldShares", () => {
  // Arrange
  const session = new Session(pendingPayoutDetails(["alice", "ben"]));

  // Act
  const completion = session.completeSettlement("out", sessionEndsAt);

  // Assert
  expect(session.status).toBe("SETTLED");
  expect(session.pendingSettlement).toBeUndefined();
  expect(
    session.participantList.participations.map((p) => p.hold?.state),
  ).toEqual(["RELEASED", "RELEASED"]);
  expect(
    completion.instructions.map(({ kind, amount }) => [kind, amount.toCents()]),
  ).toEqual([["RELEASE", 500], ["RELEASE", 500]]);
});
```

Keep actual `Participant.join` calls visible when testing admission, capacity,
queue changes, or financial instructions, and keep timing-dependent transitions
explicit. Use `sessionDetails` for special hydration scenarios.

Read roster facts through `bookingSession.participantList`: use its readonly
`participations`, `nextQueueSequence`, and `committedCount` values or its lookup
queries. For example, `bookingSession.participantList.nextWaitlisted()?.userId`
identifies the next waiter. Session hydration still takes arrays through
`sessionDetails`.

```ts
const aliceParticipation = bookingSession.participantList.requireParticipation("p-alice");
expect(aliceParticipation.status).toBe("COMMITTED");
```

Test collection query/immutability behavior separately from role workflows;
failed Session recording must preserve both roster and queue state.

Avoid generic error-capture helpers and setup hooks that hide the scenario.
Domain tests assume declared input types and exercise business constraints;
external input parsing belongs in boundary tests.

## Time expressions

Time expressions must reveal their unit, direction, and anchor. Use the shared
session fixture's `sessionStartsAt` and `sessionEndsAt` for those exact instants,
and its named helpers for offsets:

```ts
const withdrawalTime = hoursBeforeSessionStart(10);
const acceptanceTime = hoursBeforeSessionStart(9);
const joiningTime = hoursBeforeSessionStart(48);
const prematureVerificationTime = hoursBeforeSessionEnd(1);
```

Use scenario-specific variables when a test contains multiple events or reuses
a timestamp. A single-use timestamp can stay inline when the helper states its
meaning clearly. Keep milliseconds-per-hour conversion inside the fixture, and
use positive offsets with the helper that describes the intended direction.

Name exact boundaries and their one-millisecond offsets explicitly:

```ts
const refundCutoff = hoursBeforeSessionStart(30);
const oneMillisecondBeforeRefundCutoff = new Date(refundCutoff.getTime() - 1);
const automaticVerificationDueAt = hoursAfterSessionEnd(72);
const oneMillisecondBeforeAutomaticVerification = new Date(
  automaticVerificationDueAt.getTime() - 1,
);
```

The refund boundary is measured from session start; automatic attendance
verification is measured from session end. Exactly 30 hours before session start
still requires a replacement for a refund. One millisecond earlier is inside the
full-refund window. Automatic verification is allowed exactly 72 hours after
session end and rejected one millisecond earlier.

## Examples and verification

The rationale for this convention is recorded in
[ADR-0005: Domain unit-test structure](../../docs/adr/0005-domain-unit-test-structure.md).

Examples following this standard are
[user.test.ts](./accounts/user.test.ts) and
[payout-account.test.ts](./accounts/payout-account.test.ts).

When restructuring tests, preserve distinct behaviors, error codes, immutability
checks, and unchanged-state assertions. Map the old assertions to their new
cases before removing or consolidating a test; test count alone does not prove
that coverage was retained. Fix scenarios whose setup does not match their
names. Run the affected files, then `npm test`, `npm run typecheck`, and
`npm run lint`. Splitting scenarios may increase the test count without changing
production behavior. Report newly exposed production defects separately during
a tests-only cleanup.
