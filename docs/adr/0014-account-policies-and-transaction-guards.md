# ADR-0014: Account policies and transaction guards

- Status: Accepted
- Date: 2026-10-05
- Partially supersedes ADR-0003's requirement that every profile edit enter through
  a complete `User`. Full aggregate hydration under ADR-0002 is unchanged.

Profile editing previously wrote database columns directly from a server action,
while deletion constructed a newly registered `User` to check an existing account's
obligations. Both flows now call explicit domain policies through framework-independent
application code. Policies consume the facts they need; they never construct an
incomplete or fictional aggregate.

UC1-03 uses a narrow profile interface for name and preferences. The domain owns
editable profile validation and shares preference validation with `User`. The
application checks current account status and submits the validated change to a
core-owned persistence interface. The adapter translates it to an authenticated
database operation that locks and rechecks the active profile before writing.
Direct authenticated column updates are revoked, and the database operation also
enforces its public input contract. Registration may still initialize empty
preferences; submitting an edit requires selections. This avoids loading unrelated
wallet and attendance history just to edit a profile, without changing how any
existing `User` is hydrated.

UC1-04 uses the same obligation policy as `User.deactivate`, without invoking the
registration factory. Deactivation still claims the active profile, rechecks
obligations, and soft-deletes the external login outside a database transaction;
failure retains the existing compensation behavior.

Group writes lock their existing owner (or new owner on creation) and added
members' profile rows in deterministic order, and require active accounts inside
the same transaction as the group write. If a group creation commits first,
deactivation waits and its obligation recheck observes the group. If deactivation
claims the profile first, the group write is rejected. HTTP authentication alone
cannot establish this guarantee. Removing an inactive member remains possible.

`npm run lint` enforces inward source dependencies: domain imports stay inside
domain, and use-case imports stay inside use cases or domain. The check resolves
relative and alias paths, covers type imports and re-exports, and rejects computed
dependency paths that cannot be checked. Outer adapters and composition keep their
existing import freedom. No additional runtime framework or dependency container
is introduced.

Discovery retains its complete User reads and application pagination. This school
project deliberately prioritizes straightforward software engineering over read
optimization; this decision adds no new commitment workflow.
