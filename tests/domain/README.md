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
- Larger entities may use one additional level of `describe` groups for related
  behaviors, such as construction, profile changes, payout setup, and
  deactivation. Order tests by method within each group, include related getters,
  and avoid deeper nesting or shared setup hooks.
- Split files when responsibilities, fixtures, dependencies, or ownership warrant
  it. Line count alone is not a reason to split a cohesive entity's tests.
- Name each test `method_WhenCondition_ExpectedResult`. Use `constructor` for
  construction and the property name for a getter.
- Give each test one coherent scenario. Several transitions can belong together
  when they demonstrate a single lifecycle behavior.
- Prefer explicitly named tests over field-driven tables so each business rule
  and its important inputs are visible without expanding a table or helper.

## Writing a scenario

Use `// Arrange`, `// Act`, and `// Assert` comments in new and refactored tests,
with blank lines between the phases:

- **Arrange:** create the subject, inputs, and starting state for the scenario.
- **Act:** perform the behavior under test and capture any result.
- **Assert:** check the result and relevant observable state.

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
Avoid generic error-capture helpers and setup hooks that hide the scenario.
Domain tests assume declared input types and exercise business constraints;
external input parsing belongs in boundary tests.

## Examples and verification

The rationale for this convention is recorded in
[ADR-0005: Domain unit-test structure](../../docs/adr/0005-domain-unit-test-structure.md).

The first files following this standard are
[user.test.ts](./accounts/user.test.ts) and
[payout-account.test.ts](./accounts/payout-account.test.ts). Other existing
domain files can adopt it when they are next refactored.

When restructuring tests, preserve distinct behaviors, error codes, immutability
checks, and unchanged-state assertions. Fix scenarios whose setup does not match
their names. Run the affected files, then `npm test`, `npm run typecheck`, and
`npm run lint`. Splitting scenarios may increase the test count without changing
production behavior.
