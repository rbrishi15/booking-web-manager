# Personal Home dashboard

Authenticated `/` shows the next 20 upcoming bookings, ordered by Singapore start
time and session ID. Anonymous visitors continue to see the public landing.
Home has no filters or public-session feed; the Search button opens `/discover`.
Legacy query parameters on `/` do not filter a user's bookings.

The server verifies cookie identity and active-account access before acquiring a
reader. `ListUpcomingBookings` returns only sessions owned by that user or having
their `COMMITTED` participation. Both public and private sessions are eligible
through those relationships. Past, cancelled, settled, waitlisted, withdrawn and
unaccepted replacement invitations are excluded. Owner/participant overlap yields
one card. The query reads an explicit summary and never loads financial data,
room tokens or a participant roster. No migration or browser table grant is added.

Cards use a date block, sport-derived booking title, venue and Singapore time
range; full years and overnight end dates remain available. Mobile uses one
column; desktop uses two with the existing Booking sidebar and header.

`HomeState` is an exclusive `loading | ready | empty | error` union. Results live
in server props. Retry derives loading from React's navigation transition. An
unsuccessful booking read stays an error: it must not be represented as an empty
diary or a weather card.

Only a successful empty diary triggers the national Singapore 24-hour weather
forecast. Weather has its own `ready | unavailable` state; no forecast values are
invented. It includes the forecast period, update timestamp and NEA attribution.
The forecast cache is shared public data; personal bookings are never cached.
See [weather reader notes](../../lib/weather/README.md).

Stories render deterministic booking/weather fixtures without database or network
access. Unit tests cover authorization and conditional weather loading, disposable
database tests exercise owner/participant visibility and exclusion rules, and
authenticated browser tests verify the mobile/desktop dashboard and Search flow.
Existing public discovery API and Swagger contracts are unchanged.
