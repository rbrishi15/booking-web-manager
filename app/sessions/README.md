# /app/sessions

**Owner:** Neoh (liang799)

UC2-02 Create Session (server-side booking share computation), UC2-03 Manage
Session (UC2-03a Toggle Public/Private, UC2-03b Remove Participant), UC2-03c
Cancel Session. Session and Slot schema with row-level security policies.
Supabase Realtime wiring lives here to meet the 3-second slot propagation
requirement.

UC2-02's framework-independent [CreateSessions module](../../use-cases/sessions/README.md)
and acceptance tests are implemented. [parseCreateSessionInput](./create-session-input.ts)
validates the authenticated user ID separately from the raw
`{ idempotencyKey, booking, config }` request with Zod. It returns the plain
business `input` with the trusted `bookerId`, plus `submission` retry metadata.
A controller obtains the user ID from authentication, converts wire timestamps
to Dates, and parses before calling `CreateSessions.forBooker(input)`.

[RequestSessionCreationTransaction](./request-session-creation-transaction.ts)
captures the submission key, namespaces it by UC2-02 and booker, and delegates to
the shared unit of work. Inject a new instance into `CreateSessions` for each
submission. Retrying with the same key returns the original result; an intended
new session needs a new key. The use-case input contains no retry metadata.

Route handlers, authentication wiring, production repositories and transaction
adapter, and UI remain to be implemented before session creation is available to users.
