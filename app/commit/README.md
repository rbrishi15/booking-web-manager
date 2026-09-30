# /app/commit

**Owner:** Yajie (Wyjessie)

Commitment, waitlist and settlement — the most concurrency-sensitive area of
the system. Covers UC2-04 Commit to Session, waitlist FIFO promotion
(`SKIP LOCKED`), UC2-05 Withdraw and the refund policy engine (30-hour rule,
`awaiting_replacement`, forfeiture), UC2-06 Verify Attendance, and the
scheduled jobs for 72h auto-verification and the forfeiture sweep. All four
exits from the `held` state belong here.

## UC2-04 Commit to Session

[`handleCommitToSession`](./commit-to-session-handler.ts) is the HTTP
boundary. It authenticates the request, validates
`{ sessionId, idempotencyKey, roomToken? }` with Zod
([parser](./commit-to-session-input.ts)), and calls
[`CommitToSession.forParticipant`](../../use-cases/sessions/CommitToSession.ts).
The participant is always the authenticated user. Client-supplied user IDs or
amounts are stripped, and the share comes from the stored session.

The handler performs no writes. The use case loads the user and session, runs
`user.asParticipant().join(...)`, then saves the session and appends the `LOCK`
instruction in one `UnitOfWork.execute` call, so the commitment and its fund
lock succeed or fail together. The idempotency key is required; a retry with
the same key replays the original result without locking funds again.

The domain decides commit versus waitlist. Waitlist order is the session's
FIFO `queueSequence`, assigned inside that transaction. The production
unit-of-work adapter must lock the session row (`SELECT ... FOR UPDATE`) so
concurrent commits serialize; the in-memory test double does this by running
transactions one at a time.

Route mounting, the production auth and database adapters, and the UI are
not yet implemented.
