# ADR-0005: Domain unit-test structure

- Status: Accepted
- Date: 2026-09-24

## Context

Domain tests serve as readable examples of business rules. The original account
suite mixed several entities and unrelated behaviors in long scenarios. Error
capture helpers and deferred action callbacks made the state under test harder
to follow. One pending-payout rejection was actually exercised after setup had
completed.

The unit tests in
[SC2002-Project](https://github.com/liang799/SC2002-Project) provide the reference
style: descriptive method/condition/result names, visible inputs, concrete
assertions, and small setup helpers. Splitting the account suite by entity and
making each scenario explicit improved readability, but the User suite grew to
45 tests. File length alone does not indicate that an entity's tests need to be
split across more files.

## Decision

The [domain testing guide](../../tests/domain/README.md) is the maintained source
of testing conventions. `CLAUDE.md` directs contributors and coding agents to
that guide. Apply it to new and refactored domain unit tests; migrate other
existing tests as they are touched.

- Organize tests by entity or value object with one top-level `describe`.
  Keep small suites flat. Larger suites may have one additional level of
  behavior groups, with tests ordered by method and related getters included.
  Do not introduce deeper nesting or shared setup hooks that hide the scenario.
- Name scenarios `method_WhenCondition_ExpectedResult`. Each test demonstrates
  one coherent behavior; multiple transitions may stay together when the
  lifecycle itself is the behavior being tested.
- Label setup, action, and assertions with `// Arrange`, `// Act`, and
  `// Assert`. Use `// Act & Assert` for direct exception assertions, rather
  than introducing an error-capture abstraction.
- Keep scenario-specific inputs and transitions visible. Reuse fixtures for
  routine defaults and put small local helper functions below the suite.
  Prefer explicitly named scenarios over field-driven test tables.
- Assert concrete outcomes and relevant error codes through public APIs.
  Execute rejection assertions in the intended state, and verify unchanged
  state when atomicity matters. Preserve immutability and lifecycle coverage
  during refactoring.
- Split files when responsibilities, fixtures, dependencies, or ownership
  justify it. Do not split a cohesive entity's tests solely to reduce line count.

The User suite uses four groups: construction and registration, profile and
preferences, payout setup, and deactivation. The smaller PayoutAccount suite
remains flat. Vitest and the existing fixtures remain in use; this decision
introduces no new test framework, builder library, or production API.

## Consequences

- Test names and bodies can be read as examples of domain behavior, and larger
  suites are easier to navigate through their groups.
- Explicit scenarios repeat some setup and can produce longer files. This is
  an accepted tradeoff for keeping each business rule independently readable.
- Existing tests need not all be rewritten at once. Changes preserve distinct
  behaviors and run affected tests, the full suite, type checking, and linting.
- Use-case acceptance tests keep their existing UC-based organization. This
  convention concerns domain unit tests and does not change business behavior.

## References

- [HitPointsTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/HitPointsTest.java)
- [CombatantTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/CombatantTest.java)
- [SpecialSkillTest](https://github.com/liang799/SC2002-Project/blob/main/src/test/java/sc2002/turnbased/domain/SpecialSkillTest.java)
