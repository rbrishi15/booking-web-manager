# /app/discover

**Owner:** Neoh (liang799)

## UC2-01 Discover Sessions

Authenticated `/` is a personal bookings dashboard with compact date cards, or a
Singapore weather forecast when no upcoming bookings exist. It has no filters or
public discovery feed. See [`app/home/README.md`](../home/README.md).
`/discover` is the dedicated authenticated search page for public-visibility sessions. It lists upcoming, public,
open sessions, including full sessions, using the stored region. Cards show venue,
sport, region, Singapore timing, total capacity and the participant share in SGD.
Cards use the shared join confirmation. Signed-out visitors must sign in before
browsing; full sessions can accept waitlist requests without holding funds.

The creation wizard supports OneMap venue search and coordinate-based region
derivation. Discovery filters the persisted region; its tests do not establish
live OneMap availability. Private sessions are accessible through valid
[invitation links](../sessions/README.md#private-session-invitations), never this feed.

## Query and HTTP contract

`GET /api/sessions` and `/discover` require a signed-in ACTIVE account.
The API verifies either a Supabase bearer token or a same-origin login cookie
before validating filters and running `DiscoverSessions.searchPublic(criteria)`.
The server page also checks the viewer before loading results, and middleware
redirects signed-out visitors to login while preserving filters. An unverified
email is allowed, but inactive and missing accounts are rejected.

Discovery requires the existing database and Supabase authentication settings and session schema. It has no
new migration, browser table grants, wallet dependency or cached results. The
GET route declares `parse`, `run` and `serialize` through
[`discoveryAction`](./discovery-action.ts). Its factory owns one error boundary
around dependency loading, query validation, querying and serialization; the
route's `run` callback visibly invokes `DiscoverSessions.searchPublic`, and its
serializer applies pagination. It authenticates on every request and does not read a request body.
Unexpected failures return a category, execution stage, request identifier and
safe exception/cause diagnostics. Original exceptions stay in server logs.
The factory preserves five diagnostic stages: initialization, authentication, validation, query and serialization.
All responses use `Cache-Control: no-store`. See
[ADR-0015](../../docs/adr/0015-declarative-session-http-actions.md).

[`readDiscoveryRequest`](./request.ts) adapts the existing query parser to HTTP
and reports invalid queries through the discovery response mapper. The server
page and form continue to use the shared query parser directly.

Optional query parameters are `q`, `sport`, `region`, `date`, `timeFrom`, `timeTo` and
`cursor`. Sport and region use the existing registration picker vocabulary.
Blank filters mean no restriction; repeated known parameters are rejected and
unknown parameters are ignored. `q` is trimmed, limited to 100 characters, and matches
a case-insensitive literal substring of sport or venue name. SQL wildcard characters
are treated literally. Search combines with all other filters, preserving the same
ordering and pagination. A repeatable-read transaction loads only public summaries;
no wallet, membership, payout or reliability facts are loaded. An ACTIVE profile is required before the search.

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
| 500 | Unexpected failure with a diagnostic reason, stage, request identifier and safe exception/cause messages |
| 503 | Missing server settings (`DISCOVERY_API_UNAVAILABLE`) |

Errors use `{ error: { code, message } }`. A 500 keeps `INTERNAL_ERROR` and adds
`requestId`, `reason`, `stage` and `diagnostics` inside `error`, for example:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "The sessions database schema does not match this deployment. Check that database migrations have been applied.",
    "requestId": "b6b6b6b6-1234-4123-8123-123456789abc",
    "reason": "DATABASE_SCHEMA_MISMATCH",
    "stage": "query",
    "diagnostics": [
      { "message": "Database column does not exist", "code": "42703" }
    ]
  }
}
```

`diagnostics` contains one to eight entries from the exception, nested causes and
aggregate errors. Each entry includes a safe `message` of at most 500 characters
and an optional allowlisted driver `code` of at most 64 characters. Recognized
codes map to fixed safe messages; exact known messages can supply a more specific
explanation even for failures with no code or a generic code. Every other entry becomes
`{ "message": "Unknown error" }`, with its
unknown code omitted. These details allow investigation without Vercel log access,
an environment toggle or operator authentication; for example, a TLS failure can report
`{ "message": "self-signed certificate in certificate chain", "code": "SELF_SIGNED_CERT_IN_CHAIN" }`.
Raw exception text, stack traces and SQL fields are never returned. Unrecognized
message and code values are not copied into the response.

The generated UUID also appears in the `X-Request-Id` response header. If server
logs are available, search for that identifier and the structured `Session
discovery failed` entry to inspect the stage, reason and original error/cause.
Request query parameters and headers are not logged.

`reason` is one of `DATABASE_UNAVAILABLE`, `DATABASE_ACCESS_DENIED`,
`DATABASE_SCHEMA_MISMATCH`, `INITIALIZATION_FAILED` or `UNEXPECTED_ERROR`.
`stage` identifies `initialization`, `validation`, `query` or `serialization`.
The message gives a suggested next step for the category. Invalid-query 400 and
missing-settings 503 responses keep their existing shape.

Swagger UI at `/api-docs` and the
public `/api/openapi` document describe both GET discovery and POST creation,
including public discovery examples and authenticated creation.
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
The search field is labelled "Search sessions by sport or venue". The desktop sidebar
has separate Home and Discover destinations.

From 768px the same view follows the layout reviewed on PR #108: "Upcoming sessions"
is the page heading, the search bar sits directly beneath it, then the sport chips,
then photo-top cards, two per row when the results column is at least 600px wide
(a container query). The court hero and back arrow are mobile-only; on desktop the
hero's "Find Your Next Game" heading stays as a visually hidden page title, and the
sidebar provides navigation. The heading block is not focusable, so moving it to the
top with CSS `order` keeps the keyboard order (search, then chips, then results) the
same at every width. The styles live in
[`discovery-search-view.module.css`](./_components/discovery-search-view.module.css)
and apply only from 768px. Labels, form behavior, polling and the shared join
confirmation are the same at every width. Each sport chip has its own icon:
Lucide has no tennis, badminton, basketball, football or futsal icons, so
[`sport-icons.tsx`](./_components/sport-icons.tsx) draws them in the same style.
Before/after captures are in [`docs/assets/discover`](../../docs/assets/discover/README.md).

A UI-only `returnTo` URL value records the originating page and its query. Apply,
Clear and Next preserve it; it never reaches the API or reader. The back arrow
replaces the current location with the validated destination, falling back to `/`
for direct entry or invalid destinations. Browser Back/Forward still traverses
filter changes. Search and sport-chip submissions include current form drafts,
validate before navigating, and reset the cursor. The chips are plain buttons that
apply the drafts with their sport, so Search stays the form's default button and
Enter keeps an applied sport filter. Editing search does not open advanced filters.

The shared mobile navigation keeps its existing active-state behavior. Only the
active destination shows a visible label; all four retain accessible names.
Groups are part of the Sessions area and remain reachable through the account
sheet, alongside settings and logout. Sessions now opens the UC2-03a hosted-session
management page. Wallet retains its existing route destination.
The creation wizard is available at `/sessions/create`. Join confirmation reuses
the commitment endpoint; private-session details require a valid invitation.

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
disposable session stack via `npm run test:sessions:integration`.

## Background visibility updates (UC2-03a)

A valid committed query refreshes once per second while discovery is visible
and online, with an immediate refresh when visibility or connectivity returns.
Results remain server-owned. Background refresh does not create navigation
history, reset scroll, disable controls, or display the foreground loading state.
The mounted form retains unsubmitted drafts, focus and expanded filters. Explicit
Search, Apply, Next and Retry retain their existing loading behavior.

Polling avoids overlapping refreshes, pauses new work during navigation and
cleans up when the page unmounts. Server errors use the existing error outcome.
The cursor and return destination remain unchanged: a newly public session before
the current cursor belongs to an earlier page, and hiding the last session on a
page can leave that page empty. The user is never sent back to page one by polling.

The acceptance target is appearance/disappearance within three seconds after a
booker's committed change on a healthy, visible, online discovery page. Browser
throttling, offline periods and provider failures cannot satisfy that timing.
One-second refresh repeats matching-session reads; this follows
the current small-project scale assumption. Larger deployments should revisit
the query cost and polling frequency together.
