# /app/discover

**Owner:** Neoh (liang799)

## UC2-01 Discover Sessions

Authenticated `/` is a personal bookings dashboard with compact date cards, or a
Singapore weather forecast when no upcoming bookings exist. It has no filters or
public discovery feed. See [`app/home/README.md`](../home/README.md).
`/discover` is the dedicated public-session search page. It lists upcoming, public,
open sessions, including full sessions, using the stored region. Cards show venue,
sport, region, Singapore timing, total capacity and the participant share in SGD.
Cards have no join/detail action.

OneMap venue search, geocoding and postal-code-to-region derivation remain separate
work. The OneMap-specific acceptance test remains TODO; stored-region filtering
does not establish OneMap provenance.

## Query and HTTP contract

`GET /api/sessions` verifies a Supabase bearer token, validates the external query,
and passes the verified identity to `DiscoverSessions.forParticipant(...)`.
The use case loads one complete User and checks active-account eligibility through
its Participant role on every invocation. The page uses cookie authentication and
invokes the same use case directly on the server; missing or inactive accounts
redirect to login. Identity verification precedes query validation, and invalid
queries are rejected before loading the User or checking account eligibility.
Discovery uses the existing session server settings and database schema through
migration 0006; it requires no new migration or browser table grants. Results are
not cached.

The API exports an ordinary async GET handler from
[`app/api/sessions/route.ts`](../api/sessions/route.ts). Inside one `try`/`catch`,
it calls [`loadDependencies`](../http/load-dependencies.ts), then
[`requireUserId`](../http/require-user-id.ts), reads the query and invokes
`forParticipant` directly. Dependencies and the verified actor are local values;
the helpers do not modify the Request or retain shared actor state.
`loadDependencies` makes initialization failures opaque before the feature's
error mapper handles them as 500s. `requireUserId` uses the endpoint's own
authenticator, rejects absent credentials and validates the verified UUID.
The discovery mapper applies `no-store` to all responses. The exported handler
keeps the standard `Request` → `Promise<Response>` signature.

[`readDiscoveryRequest`](./request.ts) adapts the existing query parser to HTTP
and reports invalid queries through the discovery response mapper. The server
page and form continue to use the shared query parser directly.

Optional query parameters are `q`, `sport`, `region`, `date`, `timeFrom`, `timeTo` and
`cursor`. Sport and region use the existing registration picker vocabulary.
Blank filters mean no restriction; repeated known parameters are rejected and
unknown parameters are ignored. `q` is trimmed, limited to 100 characters, and matches
a case-insensitive literal substring of sport or venue name. SQL wildcard characters
are treated literally. Search combines with all other filters, preserving the same
ordering and pagination. Only the acting User is fully hydrated, including wallet
history, memberships and reliability; matching Sessions remain lightweight public
summaries. Payout setup, available funds, memberships and reliability do not limit
browsing. User hydration and listing reads share one repeatable-read transaction.
Missing required User state or malformed stored state fails as an infrastructure
error rather than substituting incomplete account facts.

Dates use `YYYY-MM-DD`; times use `HH:mm`. Date and time refer to
`Asia/Singapore`. A date alone selects that calendar day. Time bounds require a
date and match session **start**, including the lower bound and excluding the
upper bound. Omitted bounds mean midnight or the next midnight. Invalid dates,
reversed ranges and overnight ranges are rejected. Sessions that have already
started are always excluded, even when a selected date is in the past.

The use case returns all matching summaries ordered by start time at JavaScript
millisecond precision, then session ID, with no result cap. Database ordering uses
the same precision as the cursor so finer stored timestamps cannot repeat pages.
The app applies the cursor and selects at most 20 items
for each HTTP response or server-page render. Every request, including Next,
loads the complete matching list on the server; only the selected page is sent
to the browser. This keeps pagination out of the domain and use-case interface
and accepts the cost of reading the complete list for this school project.
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
Discovery registers its operation in [the feature OpenAPI module](./openapi.ts);
see the [shared OpenAPI guide](../openapi/README.md) for composition and the steps
to add another feature's operations.

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
Discover advanced filters are disclosed on both sizes. Compact cards use decorative
local sport photos, Singapore timing (including the end date for overnight sessions),
and informational session data. Photo sources and credits are in
[`public/images/sports/README.md`](../../public/images/sports/README.md).

The shared mobile shell exposes Home, Sessions, Wallet and Settings, plus a Search
button alongside the account menu. Search opens the focused `/discover` view with
a back arrow, tennis hero, mounted search/filter form, sport chips and compact cards.
The desktop sidebar has separate Home and Discover destinations.

A UI-only `returnTo` URL value records the originating page and its query. Apply,
Clear and Next preserve it; it never reaches the API or reader. The back arrow
replaces the current location with the validated destination, falling back to `/`
for direct entry or invalid destinations. Browser Back/Forward still traverses
filter changes. Search and sport-chip submissions include current form drafts,
validate before navigating, and reset the cursor. Editing search does not open
advanced filters.

The shared mobile navigation keeps its existing active-state behavior. Only the
active destination shows a visible label; all four retain accessible names.
Groups are part of the Sessions area and remain reachable through the account
sheet, alongside settings and logout. Sessions and Wallet retain their existing
route destinations; their pages are not implemented by this visual redesign.
Joining, session details and the create-session page remain separate work.

Feature-local Storybook stories render the production synchronous view with
deterministic fixtures, without Supabase or PostgreSQL. They cover results,
empty/loading/invalid/error states, pagination, long content and the 390px view.
Interaction tests cover filters, correction, Clear, Retry and pending controls.
The Discover/Mobile search page stories render the complete focused shell with the
actual controller, including disclosure/draft transitions, all states, long content,
overnight timing and dark mode. Desktop search stories include the sidebar. Home's
separate stories cover the personal booking cards and empty weather state. Static
assets are shared with Next.js. Landing stories require no authentication or database.
Run `npm run storybook`, `npm run build-storybook` and `npm run test:storybook`.
The standard app build and dev startup also stage a public static preview at
`/storybook` (redirecting to `/storybook/index.html` so relative assets resolve).

Unit tests cover query parsing, state transitions, the use-case boundary, API
errors and OpenAPI. Database and signed-in browser tests use the existing
disposable session stack via `npm run test:sessions:integration`. Automatic
refresh for UC2-03a's three-second visibility requirement remains follow-up work.
