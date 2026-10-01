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

Feature-local Storybook stories render the production synchronous view with
deterministic fixtures, without Supabase or PostgreSQL. They cover results,
empty/loading/invalid/error states, pagination, long content and the 390px view.
Interaction tests cover filters, correction, Clear, Retry and pending controls.
Run `npm run storybook`, `npm run build-storybook` and `npm run test:storybook`.

Unit tests cover query parsing, state transitions, the use-case boundary, API
errors and OpenAPI. Database and signed-in browser tests use the existing
disposable session stack via `npm run test:sessions:integration`. Automatic
refresh for UC2-03a's three-second visibility requirement remains follow-up work.
