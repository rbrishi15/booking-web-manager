# Domain unit tests

Domain tests document the behavior of entities and value objects through their
public APIs. For new and refactored tests, follow the unit-test style in
[SC2002-Project](https://github.com/liang799/SC2002-Project), particularly
[HitPointsTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/HitPointsTest.java),
[CombatantTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/CombatantTest.java),
and [SpecialSkillTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/SpecialSkillTest.java).

## Structure and naming

- Use a file named after the entity or value object, with one top-level
  `describe` and flat tests ordered by method.
- Name each test `method_WhenCondition_ExpectedResult`. Use `constructor` for
  construction and the property name for a getter.
- Give each test one coherent scenario. Several transitions can belong together
  when they demonstrate a single lifecycle behavior.
- Prefer explicitly named tests over field-driven tables so each business rule
  and its important inputs are visible without expanding a table or helper.

## Writing a scenario

Separate setup, action, and assertions with blank lines. Add short
Arrange/Act/Assert comments only when they help clarify a longer scenario.
Name observed results after what they represent, then assert concrete values.

```ts
test("completeSetup_WhenSetupIsPending_ReturnsCompletedCopy", () => {
  const pendingAccount = PayoutAccount.create({
    payoutAccountId: "account",
    userId: "owner",
    providerAccountReference: "provider",
  });

  const completedAccount = pendingAccount.completeSetup("bank");

  expect(pendingAccount.setupStatus).toBe("PENDING");
  expect(completedAccount).not.toBe(pendingAccount);
  expect(completedAccount.setupStatus).toBe("COMPLETE");
  expect(completedAccount.bankAccountReference).toBe("bank");
});
```

Use fresh objects for independent scenarios. Assert rejections directly with
`expect(() => action()).toThrow(expect.objectContaining({ code: "..." }))`.
Run the assertion while the subject is in the state named by the test; do not
save an action callback and invoke it after subsequent state changes. When
atomicity matters, also assert that rejection leaves state unchanged.

Reuse fixtures for routine defaults, but keep scenario-specific inputs and
transitions in the test. Put small local helper functions below the tests.
Avoid generic error-capture helpers and setup hooks that hide the scenario.
Domain tests assume declared input types and exercise business constraints;
external input parsing belongs in boundary tests.

## Examples and verification

The first files following this standard are
[user.test.ts](./accounts/user.test.ts) and
[payout-account.test.ts](./accounts/payout-account.test.ts). Other existing
domain files can adopt it when they are next refactored.

When restructuring tests, preserve distinct behaviors, error codes, immutability
checks, and unchanged-state assertions. Fix scenarios whose setup does not match
their names. Run the affected files, then `npm test`, `npm run typecheck`, and
`npm run lint`. Splitting scenarios may increase the test count without changing
production behavior.
