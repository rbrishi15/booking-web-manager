# Booking Web Manager

Sports venue booking coordination. One person books and pays a venue upfront,
participants commit their share into an in-app wallet where it is held, and
the held funds are released to the booker after attendance is verified.

NTU SC2006 group project, Group 3.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, non-negotiable rules,
directory ownership and conventions. See [docs/](./docs) for the SRS.

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
cp .env.example .env.local   # fill in Supabase/Stripe/OneMap/VAPID keys
npx supabase start           # local Postgres
npm run dev
```

```bash
npm run typecheck
npm run lint
npm test
npm run test:concurrency
```

## Testing

Automated tests are organised by use case in
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
