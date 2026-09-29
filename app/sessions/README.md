# /app/sessions

**Owner:** Neoh (liang799)

UC2-02 Create Session (server-side booking share computation), UC2-03 Manage
Session (UC2-03a Toggle Public/Private, UC2-03b Remove Participant), UC2-03c
Cancel Session. Session and Slot schema with row-level security policies.
Supabase Realtime wiring lives here to meet the 3-second slot propagation
requirement.

UC2-02's framework-independent [CreateSession coordinator](../../use-cases/sessions/README.md)
and acceptance tests are implemented. [parseCreateSessionInput](./create-session-input.ts)
validates the authenticated actor ID and request with Zod at the app boundary and
returns the application's plain TypeScript DTO. A controller must obtain the
actor ID from authentication separately from the request, convert wire timestamps
to Dates, parse the input, and pass the result to `CreateSession.execute`.

Route handlers, authentication wiring, production repositories and transaction
adapter, and UI remain to be implemented before session creation is available to users.
