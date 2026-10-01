# Booking Web Manager

Sports venue booking coordination. One person books and pays a venue upfront,
participants commit their share into an in-app wallet where it is held, and
the held funds are released to the booker after attendance is verified.

NTU SC2006 group project, Group 3.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, non-negotiable rules,
directory ownership and conventions. See [docs/](./docs) for the SRS.

## How session creation fits together

UC2-02 currently provides the HTTP contract, dependency interfaces, request
validation, response mapping, and Swagger documentation. The production
`POST /api/sessions` route returns `503 SESSION_API_UNAVAILABLE` with
`Session creation is not available yet` until authentication and persistence
integrations are supplied.

With dependencies injected, the [API route](./app/api/sessions/route.ts) owns
the HTTP flow and calls the use case directly:

```text
POST → authenticate → parse JSON with Zod → CreateSessions.forBooker(...)
     → load User → Booker creates Session → commit → JSON response
```

The app-owned [`SessionApiDependencies`](./app/sessions/dependencies.ts) separates
authentication from the submission-scoped use-case factory. `/use-cases`
coordinates persistence, and `/domain` owns eligibility and booking-share rules.
The [configuration guide](./use-case-config/README.md) records the missing
integrations, their owners, and merge prerequisites. The
[centralized API route tests](./tests/app/sessions/create-session-route.test.ts)
exercise the configured flow through injected dependencies and the real use
case. The domain remains framework-independent.

Run `npm run dev`, then open
[Swagger UI](http://127.0.0.1:3000/api-docs). The OpenAPI document is served at
`/api/openapi` and can also be imported into Postman. Documentation needs no
credentials or local Supabase stack; trying session creation returns 503.
Registration, sign-in and session screens, along with OneMap integration,
remain separate work.

## Team

| Member | GitHub | Area |
|---|---|---|
| Rishi | [@rbrishi15](https://github.com/rbrishi15) | Repository owner; domain layer and payments — `/domain`, `/app/wallet`, `/app/payouts`, `/app/api/webhooks`, CI |
| Harrison | [@harr008](https://github.com/harr008) | Wallet ledger and financial integrity — `/lib/money`, ledger schema, reconciliation |
| Yajie | [@Wyjessie](https://github.com/Wyjessie) | Commitment, waitlist and settlement — `/app/commit`, waitlist, verification, schedulers |
| Neoh | [@liang799](https://github.com/liang799) | Session and venue domain — `/app/sessions`, `/app/discover`, OneMap |
| Joseph | [@Jolingoes](https://github.com/Jolingoes) | Identity, groups and frontend platform — `/app/(auth)`, `/app/profile`, `/app/groups`, `/components/ui` |

## Getting started

Use Node.js 22.x, declared in `package.json` under `engines.node`. Both CI jobs
read that setting, and [Vercel uses it for builds and functions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

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

The session contract, Swagger page, and unavailable route need no environment
credentials. The settings below apply to other integrations as they are added.

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

Session contract tests run with `npm test` and injected dependencies.
`npm run test:e2e` builds and starts Next.js, checks the public OpenAPI and
Swagger documentation, and verifies the production route's 503 response.
These [HTTP/browser tests](./tests/e2e) need no Supabase stack or credentials;
live authentication, persistence, and database concurrency remain unverified
until their integrations are implemented.

## Contributing

- `main` is protected: no direct pushes, no force pushes, PRs required.
- A PR touching another member's directory needs that member's approval in
  addition to Rishi's (enforced via [CODEOWNERS](./.github/CODEOWNERS)),
  except `/app/(auth)` and `/components/ui`, where Joseph's approval alone is
  sufficient.
- Migrations are a single numbered sequence — merge a migration PR before
  opening dependent feature work.
