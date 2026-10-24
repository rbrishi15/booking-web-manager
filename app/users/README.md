# /app/users

**Owner:** Joseph (Jolingoes)

Public user IDs ([ADR-0021](../../docs/adr/0021-user-ids-for-finding-players.md)):
the Telegram-style `@name` other players find you by. UC1-01 asks for one at
sign-up and UC1-03 changes it in Edit profile; those flows live in `app/(auth)`
and `app/profile` and reuse what is here.

| File | Purpose |
| --- | --- |
| [`schemas.ts`](./schemas.ts) | `userHandleSchema` for forms: the first broken rule as a readable message, then the stored lower-case form. |
| [`_components/user-handle-field.tsx`](./_components/user-handle-field.tsx) | The `@` input with the rules, a live availability check and server errors. |
| [`handle-availability-action.ts`](./handle-availability-action.ts) | Public server action: AVAILABLE, TAKEN, INVALID, or UNKNOWN when the check cannot run. |
| [`find-player-action.ts`](./find-player-action.ts), [`_components/find-player.tsx`](./_components/find-player.tsx) | "Find a player" on the Groups page: signed-in exact search showing the player's name, `@id` and reliability score. |
| [`user-lookup-action.ts`](./user-lookup-action.ts), [`user-lookup-response.ts`](./user-lookup-response.ts), [`openapi.ts`](./openapi.ts) | `GET /api/users/by-handle/{handle}`: signed-in exact lookup, its error mapping and its API reference. |

The live check waits 400 ms after the last keystroke and ignores answers to
older keystrokes. It never blocks saving: the register action and
`update_profile` check again, and the database's unique index decides.

The lookup returns only an active player's `userId`, `handle` and
`displayName`, and matches the whole ID (ignoring case and a leading `@`). It
answers 400 for a malformed ID, 404 when nobody active holds it, 401 when signed
out and 503 without database settings. Store the user UUID, never the user ID,
because IDs can change.

Run `npm test -- tests/domain/accounts/user-handle.test.ts tests/use-cases/UC1-03-user-handles.test.ts tests/app/users`.
`tests/use-cases/UC1-01-user-handles.db.test.ts` checks the sign-up trigger, the
unique index and `update_profile` against real Postgres when
`USER_HANDLES_TEST_DATABASE_URL` points at a disposable local database.
