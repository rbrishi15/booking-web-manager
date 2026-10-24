# ADR-0021: User IDs for finding players

- Status: Accepted
- Date: 2026-10-24
- Extends: [ADR-0014](./0014-account-policies-and-transaction-guards.md)'s narrow
  UC1-03 profile write, which now also carries the user ID. Nothing is
  superseded.

Players need a way to find each other, for example to invite a known player, that
does not depend on an email address or the internal user UUID. The feature asks
for something like a Telegram username: chosen by the user, unique, and asked for
during sign-up.

## Decision

Every active account has a public **user ID** (`handle` in code and storage),
shown as `@name`.

- **Format:** Telegram's username rules. 5-32 characters of `a-z`, `0-9` and `_`,
  starting with a letter, with no trailing or repeated underscore. Input may
  include spaces around it, one leading `@` and capitals; the `UserHandle` value
  object (`domain/accounts/user-handle.ts`) normalises it to lower case without
  `@`. Uniqueness therefore ignores letter case.
- **Storage:** `profiles.handle`, with a check constraint for the same format, a
  unique index, and a second check that every ACTIVE profile has one (migration
  0016). Only deactivated profiles have none. The database is the final judge of
  uniqueness; application checks only give earlier feedback.
- **Generated IDs:** whenever an ACTIVE profile would be written without an ID, a
  trigger makes one from the name: "Marcus Lim" becomes `marcus_lim`, or
  `marcus_lim_4821` when that is taken; a name without letters `a-z` becomes
  `player` or `player_NNNN`. Generated IDs follow the same rules and can be
  changed like chosen ones.
- **Choosing at sign-up (UC1-01):** sign-up gains a third step, "Your user ID",
  after account details and profile. The step checks the format as the person
  types and asks the server whether the ID is free. The register action checks
  again, then sends the ID as sign-up metadata. If another sign-up takes the ID
  in between, the trigger still creates the account, with the chosen ID plus a
  four-digit number, so sign-up never fails because of that race.
- **Changing it (UC1-03):** Edit profile includes the user ID and every save
  must keep one. `UpdateProfile` validates it with `UserHandle`; the guarded
  `update_profile` write sets it in the same locked transaction as the other
  profile fields and reports a taken ID as `PRF04`, which the adapter translates
  to `DomainError("HANDLE_TAKEN")`. Omitting it leaves the stored ID unchanged,
  so app versions deployed before migration 0016 keep working.
- **Existing accounts** receive a generated ID when migration 0016 runs, one at a
  time in sign-up order so two people with the same name get different IDs.
  Settings shows it under the name and Edit profile changes it, so no prompt is
  needed.
- **Deletion (UC1-04)** clears the ID with the other personal details, so it
  becomes free for others. If a failed deletion is undone after someone else
  took the ID, the account is restored with a newly generated ID.
- **Lookup:** `FindUserByHandle` returns the ACTIVE account holding exactly that
  ID, as `{ userId, handle, displayName }`, through the signed-in
  `GET /api/users/by-handle/{handle}` route. There is no partial-match or list
  search, so the directory cannot be browsed.
- **Finding a player (Groups page):** a "Find a player" box at the top of Groups
  runs the same lookup for the signed-in player and shows the found player's
  name, `@id` and reliability score (the same history-based score as Settings,
  or "unavailable"). The internal user UUID is not sent to the browser.
- **Availability check:** `CheckUserHandle` answers AVAILABLE, TAKEN or INVALID.
  The server action that calls it is public, because people check before their
  account exists. It reveals only whether an ID is taken, as Telegram does.

`User` is not changed: no current domain rule depends on the user ID. Profile
reads stay owner-only under row-level security; the lookup and availability
check read through the server's database connection and return only the fields
above.

## Consequences

- A user ID is public by design. Anyone signed in who knows it can see that
  player's name and reliability score; anyone can learn whether an ID is taken.
  The reliability score was already visible to session participants; search
  makes it visible to anyone who knows the exact ID.
- Telegram-style rules keep IDs readable and safe in URLs without escaping.
- People whose ID was generated may not know it until they open Settings. A
  generated ID can look like someone else's name, but it reveals nothing beyond
  the display name the account already shows to session participants.
- IDs can change, so other features must store the user UUID, never the ID.
- Invite flows (for example replacement invitations or adding someone to a
  group) can reuse the same lookup; this decision provides the capability, the
  Groups search and the API contract.
