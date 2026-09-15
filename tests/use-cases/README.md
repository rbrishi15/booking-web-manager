# /tests/use-cases

One Vitest file per use case ID from the SRS, named `UC<n>-<seq>-<slug>.test.ts`.
Each starts as `test.todo(...)` — reserve the acceptance criteria as todos
before the feature exists, then fill them in as real tests when you build it.
Keep the UC ID in the file name and the top-level `describe` block; that's
what makes a UC traceable to its test from a commit message, a PR title, or
`git grep UC2-04`.

Ownership follows the feature directory that implements the use case — see
[CODEOWNERS](../../.github/CODEOWNERS).
