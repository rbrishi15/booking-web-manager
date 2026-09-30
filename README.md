# Booking Web Manager

Sports venue booking coordination. One person books and pays a venue upfront,
participants commit their share into an in-app wallet where it is held, and
the held funds are released to the booker after attendance is verified.

NTU SC2006 group project, Group 3.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, non-negotiable rules,
directory ownership and conventions. See [docs/](./docs) for the SRS.

## How session creation fits together

[`use-case-config/sessions.ts`](./use-case-config/sessions.ts) connects the
session HTTP handler to authentication, transactions, IDs, and the clock:

```text
Request → authenticate → parse JSON with Zod → CreateSessions.forBooker(...)
        → load User → Booker creates Session → commit → Response
```

The app layer handles HTTP and parsing; `/use-cases` coordinates persistence;
`/domain` owns eligibility and booking-share rules. Infrastructure adapters in
`/lib` implement application contracts. The outer `/use-case-config` module
assembles these pieces without putting framework dependencies into the core.
See the [configuration guide](./use-case-config/README.md) for setup and the
dependencies a real server must supply, and the
[centralized HTTP handler tests](./tests/use-case-config/sessions.test.ts) for
executable examples. The handler is tested as a function; route mounting,
production authentication and database adapters, and session UI remain future work.

## Team

| Member | GitHub | Area |
|---|---|---|
| Rishi | [@rbrishi15](https://github.com/rbrishi15) | Repository owner; domain layer and payments — `/domain`, `/app/wallet`, `/app/payouts`, `/app/api/webhooks`, CI |
| Harrison | [@harr008](https://github.com/harr008) | Wallet ledger and financial integrity — `/lib/money`, ledger schema, reconciliation |
| Yajie | [@Wyjessie](https://github.com/Wyjessie) | Commitment, waitlist and settlement — `/app/commit`, waitlist, verification, schedulers |
| Neoh | [@liang799](https://github.com/liang799) | Session and venue domain — `/app/sessions`, `/app/discover`, OneMap |
| Joseph | [@Jolingoes](https://github.com/Jolingoes) | Identity, groups and frontend platform — `/app/(auth)`, `/app/profile`, `/app/groups`, `/components/ui` |

## Getting started

```bash
npm install
npm run dev
```

```bash
npm run typecheck
npm run lint
npm test
npm run test:concurrency
```

### Environment variables

Real values live in the project's Vercel settings, not in git. If you've been
added as a collaborator on the `rishi-331c/booking-web-manager` Vercel
project:

```bash
npx vercel link          # first time only — links this checkout to the project
npx vercel env pull      # writes .env.local from Vercel's Development env vars
```

Re-run `vercel env pull` whenever a new variable gets added (Stripe, OneMap,
VAPID, etc.) instead of copying values by hand — it overwrites `.env.local`
with whatever's currently in Vercel, so there's one source of truth instead of
five drifting local copies.

One thing `vercel env pull` can't do: variables stored as a **Secret**
(currently `SUPABASE_SERVICE_ROLE_KEY`) are write-only by design — once set,
Vercel will never hand the value back to anyone, including its own CLI. A pull
writes `[SENSITIVE]` as a placeholder for those instead of the real value.
That's expected, not a bug — those keys should only ever live inside Vercel's
serverless functions, never on a laptop or in a browser, so you shouldn't need
the actual value locally. If a local script genuinely needs it, ask Rishi to
paste it directly rather than trying to pull it.

Not on the Vercel project yet, or need to run entirely offline? Fall back to
`cp .env.example .env.local` and fill in your own test-mode/dev keys — see
that file for what each variable is for.

`npx supabase start` gets you local Postgres if you're testing against a real
database (needs Docker); most day-to-day work doesn't need it. See
[supabase/README.md](./supabase/README.md#local-development) for the full
local-development workflow — starting it, working on a migration, and
pointing the app at local Postgres instead of the hosted project.

## Testing

Domain unit tests live in [tests/domain](./tests/domain). Follow the
[domain testing standard](./tests/domain/README.md) for test structure, naming,
fixtures, and assertions.

Use-case acceptance tests are organised in
[tests/use-cases](./tests/use-cases) — one file per UC ID, starting as
`test.todo(...)` stubs. Fill in your UC's test as you build the feature; see
that folder's README for the convention.

## Contributing

- `main` is protected: no direct pushes, no force pushes, PRs required.
- A PR touching another member's directory needs that member's approval in
  addition to Rishi's (enforced via [CODEOWNERS](./.github/CODEOWNERS)),
  except `/app/(auth)` and `/components/ui`, where Joseph's approval alone is
  sufficient.
- Migrations are a single numbered sequence — merge a migration PR before
  opening dependent feature work.
