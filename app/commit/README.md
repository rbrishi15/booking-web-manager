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

The route is mounted at `POST /api/sessions/commit`; see [HTTP handlers](#http-handlers).
The UI is not yet implemented.

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
conflicts such as insufficient funds or an unfinished session), unconfigured
server settings to 503, and anything else to an opaque 500. Responses are not
cached.

| Route | Handler | Body | Success |
| --- | --- | --- | --- |
| `POST /api/sessions/commit` | [`handleCommitToSession`](./commit-to-session-handler.ts) | `{ sessionId, idempotencyKey, roomToken? }` | 201 |
| `POST /api/sessions/withdraw` | [`handleWithdrawFromSession`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey, replacement: { mode: "OPEN_SLOT" } \| { mode: "DIRECT_INVITE", inviteeId } }` | 200 |
| `POST /api/sessions/replacements/accept` | [`handleAcceptReplacement`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey }` | 201 |
| `POST /api/sessions/waitlist/leave` | [`handleLeaveWaitlist`](./withdrawal-handlers.ts) | `{ sessionId, idempotencyKey }` | 200 |
| `POST /api/sessions/attendance` | [`handleVerifyAttendance`](./verify-attendance-handler.ts) | `{ sessionId, idempotencyKey, marks: [{ participationId, attendance }] }` | 200 |

The routes share one set of dependencies from
[`getCommitmentDependencies`](./commitment-server-dependencies.ts), assembled in
[`use-case-config/commitments.ts`](../../use-case-config/commitments.ts): a
Supabase bearer-token identity check and the
[`PostgresCommitmentUnitOfWork`](../../lib/sessions/postgres-commitment-unit-of-work.ts).
Authentication only verifies identity; the unit of work loads the complete
User, whose roles enforce account status, email verification and reliability.
Until Web Push is configured, notifications go to a
[`NoDeliveryNotifier`](../../lib/commit/no-delivery-notifier.ts) that accepts
and discards them.

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

The route is mounted at `GET /api/cron/commitments`
([route](../api/cron/commitments/route.ts),
[configuration](../../use-case-config/scheduled-jobs.ts)), with up to 25
sessions per run.
[`PostgresDueSessionQuery`](../../lib/commit/postgres-due-session-query.ts)
selects open sessions that have started with a late withdrawal still awaiting
replacement, have not started and have people waiting with a free place, or
ended at least 72 hours ago.
[`PostgresVerificationReminderQuery`](../../lib/commit/postgres-verification-reminder-query.ts)
claims and releases reminders through `sessions.verification_reminded_at`
(migration 0009). It is not wired in yet: until Web Push can deliver
reminders, the sweep claims none, so none are marked as sent and lost.

Not yet configured: the schedule itself, either a Vercel Cron entry (the Hobby
plan runs crons at most daily) or a `pg_cron` + `pg_net` job calling the route
with the secret.

## Notifications

Use cases report events through the
[`CommitmentNotifier`](../../use-cases/sessions/commitment-notifications.ts)
port, always **after** their unit of work commits (rule #4) and best-effort: a
failed notification never undoes or fails a committed change. A retried request
replays its result and notifies again, so delivery is at-least-once.

| Notification | Recipient | Sent by |
| --- | --- | --- |
| `PROMOTED` | Promoted participant | `PromoteFromWaitlist` |
| `REPLACEMENT_INVITATION` | Named invitee | `WithdrawFromSession` (`DIRECT_INVITE`) |
| `FORFEITURE_WARNING` | Late withdrawer | `WithdrawFromSession` (awaiting replacement) |
| `FORFEITURE_DUE` | Late withdrawer | `ExpireReplacements` at session start |
| `VERIFICATION_REMINDER` | Booker | Scheduled sweep, via a `VerificationReminderQuery` claim so each booker is reminded once per session; claims are released for retry if the hand-off to the notifier fails |

[`WebPushNotifier`](../../lib/commit/web-push-notifier.ts) is the Web Push
adapter. It holds the notification text, sends to every subscription the
recipient registered, and removes subscriptions the push service reports as
expired. It takes a `PushSubscriptionStore` and a `PushSender`, and gives each
lookup, send and removal a deadline (5 s by default) so a push service that never
answers cannot hold a request open after its unit of work commits.

Not yet built: the `web-push` dependency behind `PushSender` (VAPID keys are
already in `.env.example`), a `push_subscriptions` table and its store, the
subscribe endpoint, and the service worker that displays payloads.
