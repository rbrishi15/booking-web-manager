# /app/profile

**Owner:** Joseph (Jolingoes)

UC1-03 Manage Profile, UC1-04 Delete Account (soft delete —
`User.anonymise()`, not `delete()`). Reliability score computation and
display.

Profile edits invoke `UpdateProfile` through `use-case-config/profiles.ts`.
The domain profile policy validates the editable fields using only account
status and the proposed changes; it does not construct an incomplete User or
load financial history. The server action handles the form, verified identity
and response; the Supabase adapter owns storage translation.

Apply `0011_profile_policy_guards.sql` with this version. It replaces direct
authenticated profile updates with `update_profile`, which checks identity,
validates the edit and locks the profile while checking active status. This
prevents an edit from restoring personal details after concurrent deactivation.
Registration still permits empty preferences; the signup trigger filters
unsupported metadata choices. Existing profile rows are not rewritten.

Run `npm test -- tests/use-cases/UC1-03-manage-profile.test.ts tests/app/profile/actions.test.ts`
for application coverage and `npm run test:integration` for the real RPC,
privilege, signup and deactivation-race scenarios on the disposable stack.
See [ADR-0014](../../docs/adr/0014-account-policies-and-transaction-guards.md).
