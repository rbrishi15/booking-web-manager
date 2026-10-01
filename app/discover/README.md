# /app/discover

**Owner:** Neoh (liang799)

## UC2-01 Discover Sessions

`/discover` is the signed-in home page. It lists upcoming, public, open sessions,
including full sessions, using the region already stored by session creation.
Cards show the venue, sport, region, Singapore timing, total capacity and the
integer-cent participant share formatted in SGD. Cards have no join/detail action.

OneMap venue search, geocoding and postal-code-to-region derivation remain separate
work. The OneMap-specific acceptance test remains TODO; stored-region filtering
does not establish OneMap provenance.

## Query and HTTP contract

`GET /api/sessions` verifies a Supabase bearer token and current active account.
The page uses cookie authentication and invokes the same discovery use case
directly on the server. Discovery uses the existing session server settings and
database schema through migration 0006; it requires no new migration or browser
table grants. Results are not cached.

Optional query parameters are `sport`, `region`, `date`, `timeFrom`, `timeTo` and
`cursor`. Sport and region use the existing registration picker vocabulary.
Blank filters mean no restriction; repeated known parameters are rejected and
unknown parameters are ignored.

Dates use `YYYY-MM-DD`; times use `HH:mm`. Date and time refer to
`Asia/Singapore`. A date alone selects that calendar day. Time bounds require a
date and match session **start**, including the lower bound and excluding the
upper bound. Omitted bounds mean midnight or the next midnight. Invalid dates,
reversed ranges and overnight ranges are rejected. Sessions that have already
started are always excluded, even when a selected date is in the past.

Results are ordered by start time, then session ID, with 20 items per page.
`nextCursor` is an opaque continuation value; clients should reuse it with the
same filters and reset it whenever filters change. The response is
`{ items, nextCursor }`, with a null cursor on the last page. Each item contains
`sessionId`, `venueName`, `sport`, `region`, ISO `startAt`/`endAt`, `totalSlots` and
integer `bookingShareCents`. Room tokens, account/participant identities and
financial internals are never included. Total capacity is not available places;
the latter also depends on replacement reservations.

| Status | Outcome |
| --- | --- |
| 200 | Results or an empty page |
| 400 | Invalid filters, dates, time range or cursor |
| 401 | Missing or invalid bearer credentials |
| 403 | Inactive account |
| 404 | Authenticated identity has no profile |
| 500 | Unexpected configuration, authentication or database failure |
| 503 | Missing server settings (`DISCOVERY_API_UNAVAILABLE`) |

Errors use `{ error: { code, message } }`. Swagger UI at `/api-docs` and the
public `/api/openapi` document describe both GET discovery and POST creation,
including examples and bearer-authenticated Try it out.

## React state and Storybook

The URL owns applied filters and pagination; server props own results. Form
fields own unsubmitted edits. A small navigation controller derives a tagged
`loading | ready | invalid | error` view from the server outcome, React's pending
transition and tagged local validation feedback. Empty results and next-page
availability are derived from a successful page, not stored as independent flags.

Apply validates before navigation and resets pagination. Editing clears local
validation feedback. Clear restores the default query; Next preserves applied
filters; Retry refreshes the current query. A controller keyed by the committed
query restores form defaults during back/forward navigation. Pending controls
are disabled and the result area announces its busy state.

Below 768px the filter form is a disclosure with one presentation state:
`collapsed | expanded`. A committed query starts collapsed unless invalid;
invalid submission expands it. The form stays mounted when hidden, preserving
unsubmitted edits, while its summary describes only applied URL filters.
Desktop filters stay visible. Cards use decorative local sport photos,
compact Singapore timing (including the end date for overnight sessions), and
the same informational session data. Photo sources and credits are in
[`public/images/sports/README.md`](../../public/images/sports/README.md).

The shared mobile shell exposes Home, Sessions, Wallet and Settings. Only the
active destination shows a visible label; all four retain accessible names.
Groups are part of the Sessions area and remain reachable through the account
sheet, alongside settings and logout. Sessions and Wallet retain their existing
route destinations; their pages are not implemented by this visual redesign.
Personal upcoming bookings, joining, session details and the create-session page
also remain outside this work.

Feature-local Storybook stories render the production synchronous view with
deterministic fixtures, without Supabase or PostgreSQL. They cover results,
empty/loading/invalid/error states, pagination, long content and the 390px view.
Interaction tests cover filters, correction, Clear, Retry and pending controls.
The Mobile page stories render the complete shared shell with the actual form
controller, including disclosure/draft transitions, all result states, long
content, overnight timing and dark mode. Static assets are shared with Next.js.
The Desktop page stories cover the same outcomes in the full Booking. layout:
an inset sidebar, faded court background, prominent introduction and two-column
photo cards from 1024px (one column on smaller screens). The shared route loading
and error fallbacks retain the desktop identity. Card prices show the SGD share
per person; total capacity is still distinct from available places.
Run `npm run storybook`, `npm run build-storybook` and `npm run test:storybook`.

Unit tests cover query parsing, state transitions, the use-case boundary, API
errors and OpenAPI. Database and signed-in browser tests use the existing
disposable session stack via `npm run test:sessions:integration`. Automatic
refresh for UC2-03a's three-second visibility requirement remains follow-up work.
