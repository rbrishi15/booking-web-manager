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
boundary. Like every handler here, it uses the shared
[`handleAuthenticatedJson`](./http.ts): it authenticates the request, validates
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

## Waitlist promotion

[`PromoteFromWaitlist.forSession`](../../use-cases/sessions/PromoteFromWaitlist.ts)
fills free places from the waitlist in FIFO `queueSequence` order, in one unit
of work. For each unreserved free place it loads the queue head's User and calls
`promoteFromWaitlist` as that participant. A head who is inactive, below the
reliability minimum, or cannot fund the share is skipped and leaves the queue.
A head holding a personal replacement invitation must accept it explicitly
(ADR-0006), so promotion stops there. Each promotion locks the entrant's share
and refunds the oldest late open-slot withdrawal it replaces, all in the same
transaction; any failure promotes nobody.

Its `triggerKey` identifies the event that may have freed a place (one
withdrawal, one waitlist departure, one scheduler run), not the session: the
unit of work replays results by key. Withdrawal and waitlist departure will call
it after their own transaction commits, and a scheduled sweep will call it to
recover any trigger lost in between. That sweep's adapter is where
`SELECT ... FOR UPDATE SKIP LOCKED` applies, so concurrent workers each take
different sessions.

## UC2-05 Withdraw from Session

Every action finds the caller's participation from their authenticated user
ID, so nobody can act on another person's place, and each takes an
idempotency key.

- [`WithdrawFromSession`](../../use-cases/sessions/WithdrawFromSession.ts) runs
  `Participant.withdraw` in one unit of work. More than 30 hours before start,
  the share is refunded at once (the REFUND is written with the session
  change). At 30 hours or less it stays held, awaiting a replacement. The
  participant chooses either `OPEN_SLOT` or `DIRECT_INVITE` for one named,
  existing user, and cannot change it later (ADR-0006).
- [`AcceptReplacement`](../../use-cases/sessions/AcceptReplacement.ts) lets the
  named invitee take the reserved place: their LOCK and the late withdrawer's
  REFUND are written together.
- [`LeaveWaitlist`](../../use-cases/sessions/LeaveWaitlist.ts) removes a waiting
  participant; no funds are held, so no ledger entry is written.
- [`ExpireReplacements`](../../use-cases/sessions/ExpireReplacements.ts) is the
  forfeiture sweep for session start. It marks late withdrawals still awaiting
  a replacement as `FORFEITURE_DUE`; the FORFEIT ledger line that credits the
  booker is written when the session's payout completes.

An open-slot withdrawal and a waitlist departure then run waitlist promotion in
a separate unit of work ([follow-up-promotion.ts](../../use-cases/sessions/follow-up-promotion.ts)).
If that fails, the committed withdrawal is kept and the result reports
`DEFERRED`; the scheduled promotion sweep fills the place later.

The 30-hour boundary follows CLAUDE.md and the domain: exactly 30 hours is a
late withdrawal. The product-owner diagram includes exactly 30 hours in the
refund window; that discrepancy is tracked in the waitlist discussion document.

## UC2-06 Verify Attendance

- [`VerifyAttendance`](../../use-cases/sessions/VerifyAttendance.ts) records the
  booker's marks after the session ends. `Booker.verifyAttendance` rejects
  anyone but the session's booker.
- [`AutoVerifyAttendance`](../../use-cases/sessions/AutoVerifyAttendance.ts) is
  the scheduler's job: 72 hours after the session **ends**, every committed
  participant still unverified is marked attended. Booker marks are kept. A run
  that is not due, or finds the session no longer open, changes nothing and
  says why.

Once every committed participant is verified the session becomes
`AWAITING_PAYOUT`. Verification itself moves no money: attended shares become
`RELEASE` lines and absent or forfeiture-due shares `FORFEIT` lines of the
booker's payout, and the payout flow (`/app/payouts`) writes those ledger lines
when the provider confirms.

## HTTP handlers

All handlers take the acting user from authentication and require an
idempotency key; Zod strips any other field, so a body cannot name another user
or supply an amount. Known domain errors map to 4xx responses with their code
(403 for access and authorization, 404 for missing records, 409 for state
conflicts such as insufficient funds or an unfinished session) and anything else
to an opaque 500.

| Handler | Body | Success |
| --- | --- | --- |
| [`handleCommitToSession`](./commit-to-session-handler.ts) | `{ sessionId, idempotencyKey, roomToken? }` | 201 |
| [`handleWithdrawFromSession`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey, replacement: { mode: "OPEN_SLOT" } \| { mode: "DIRECT_INVITE", inviteeId } }` | 200 |
| [`handleAcceptReplacement`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey }` | 201 |
| [`handleLeaveWaitlist`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey }` | 200 |
| [`handleVerifyAttendance`](./verify-attendance-handler.ts) | `{ sessionId, idempotencyKey, marks: [{ participationId, attendance }] }` | 200 |

Promotion, forfeiture expiry and auto-verification have no HTTP handler; the
scheduler calls them.

## Scheduled jobs

[`RunScheduledSessionJobs`](../../use-cases/sessions/RunScheduledSessionJobs.ts)
is the periodic sweep. It asks a
[`DueSessionQuery`](../../use-cases/sessions/scheduling-ports.ts) for up to one
batch of sessions that may have work due. For each one it runs
`ExpireReplacements`, then `PromoteFromWaitlist`, then `AutoVerifyAttendance`,
each in its own unit of work keyed by the run ID. Every job re-checks its own
rule, so a superset of sessions is safe. A failing job is reported and the sweep
moves on; the next run retries it. This sweep also recovers promotions that a
withdrawal reported as `DEFERRED`.

[`handleScheduledJobs`](./scheduled-jobs-handler.ts) is the cron entry point. It
accepts only `Authorization: Bearer <CRON_SECRET>`, compared in constant time,
and an unset secret authorizes nothing. Each call starts a new run.

Not yet built: the Postgres `DueSessionQuery` adapter (it needs the sessions
schema; it should select with `FOR UPDATE SKIP LOCKED`) and the schedule itself,
either a `pg_cron` + `pg_net` migration or a Vercel Cron entry.
