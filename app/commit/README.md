# /app/commit

**Owner:** Yajie (Wyjessie)

Commitment, waitlist and settlement — the most concurrency-sensitive area of
the system. Covers UC2-04 Commit to Session, waitlist FIFO promotion
(`SKIP LOCKED`), UC2-05 Withdraw and the refund policy engine (30-hour rule,
`awaiting_replacement`, forfeiture), UC2-06 Verify Attendance, and the
scheduled jobs for 72h auto-verification and the forfeiture sweep. All four
exits from the `held` state belong here.

## UC2-04 Commit to Session

[`POST /api/sessions/commit`](../api/sessions/commit/route.ts) is the HTTP
boundary. Like every commitment route, it is built with
[`commitmentAction`](./commitment-action.ts): the route validates
`{ sessionId, idempotencyKey, roomToken? }` with Zod
([parser](./commit-to-session-input.ts)) and calls
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

The route is mounted at `POST /api/sessions/commit`; see [HTTP routes](#http-routes).
Each Discover result has a **Join** button
([`JoinSessionButton`](./_components/join-session-button.tsx)). Its dialog shows the
share that will be held before the player confirms, then calls the route through
[`joinSession`](./join-session-transport.ts). One idempotency key covers every attempt
while the dialog is open, so retrying an unconfirmed result cannot hold the share twice.

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

### Withdraw / Leave-waitlist screens

React Query handles server state, the flow hooks handle interaction state, and the backend
enforces the financial rules.

- [`JoinedSessionsView`](./_components/joined-sessions-view.tsx) is presentational:
  it shows the player's places and reports which one they want to withdraw from or leave.
- [`WithdrawalDialog`](./_components/withdrawal-dialog.tsx) and
  [`LeaveWaitlistDialog`](./_components/leave-waitlist-dialog.tsx) are single controlled
  dialogs for the whole list, display only.
- [`useWithdrawalFlow`](./use-withdrawal-flow.ts) and
  [`useLeaveWaitlistFlow`](./use-leave-waitlist-flow.ts) use React Query for the refund
  preview (`useQuery`), the actions (`useMutation`, with failures thrown as a typed
  [`SessionActionError`](./withdrawal-errors.ts)) and refreshing the joined sessions and
  wallet ([query keys](./withdrawal-query-keys.ts)). They keep only the interaction state: the
  selected session, the replacement choice, unresolved requests and whether the terms changed.
- The refund shown is a snapshot of what the player saw. React Query never replaces it in the
  background (focus and reconnect refetches are off); it is checked against the server just
  before withdrawing, and if it changed the player confirms the new terms. The final 30-hour
  decision is still the server's, at the moment of the withdrawal.
- Query keys for joined sessions and previews include the user ID, so a cache that outlives
  an account change never shows one user's data to another.

**Recovery strategy for unresolved requests** (a withdrawal or departure whose outcome is
unknown), in [`withdrawal-recovery.ts`](./withdrawal-recovery.ts):

1. Kept per user and session, and saved in this browser's `localStorage` under a key that
   includes the user ID, so it survives a reload.
2. Only ever retried exactly, with the same idempotency key, so the server replays the
   original result instead of acting twice. The dialogs offer "Retry" and "Retry later", never
   "Keep my place", because the action may already have happened.
3. Cleared only when its outcome is established: a retry succeeds, or the server's
   joined-sessions list shows the place has gone. A retry that fails, including for an
   expired login, never clears it.

- [`withdrawal-transport.ts`](./withdrawal-transport.ts) calls the existing preview,
  withdraw and leave-waitlist routes, validates each reply with Zod and maps it explicitly to
  [`withdrawal-ports.ts`](./withdrawal-ports.ts).
- The joined-sessions list has no API yet; stories use
  [`withdrawal-fakes.ts`](./_components/withdrawal-fakes.ts). The page, the composition root
  that loads the list with React Query and provides the `QueryClient`, follows once it exists.

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

**UI.** My sessions lists ended sessions with players still to check
(`ListHostedSessions.attendanceDueForBooker`). Their participant page shows
[`AttendanceVerificationForm`](./_components/attendance-verification-form.tsx):
the booker marks each unverified committed player attended or absent, confirms,
and the marks go to `POST /api/sessions/attendance` through
[`verifyAttendance`](./verify-attendance-transport.ts). After an unconfirmed
result the same key and marks are kept and the choices locked, so a retry
can only replay that request.

## HTTP routes

Each route file names only its parser and its use-case call:

```ts
export const POST = commitmentAction({
  parse: parseVerifyAttendanceInput,
  run: (dependencies, input) => dependencies.verifyAttendance.forBooker(input),
  invalidRequestMessage: "Invalid attendance verification request",
});
```

[`commitmentAction`](./commitment-action.ts) owns the shared HTTP policy
through [`handleAuthenticatedJson`](./http.ts). All routes take the acting user from authentication and require an
idempotency key; Zod strips any other field, so a body cannot name another user
or supply an amount. Known domain errors map to 4xx responses with their code
(403 for access and authorization, 404 for missing records, 409 for state
conflicts such as insufficient funds or an unfinished session), unconfigured
server settings to 503, and anything else to an opaque 500. Responses are not
cached.

| Route | Parser | Body | Success |
| --- | --- | --- | --- |
| [`POST /api/sessions/commit`](../api/sessions/commit/route.ts) | [`parseCommitToSessionInput`](./commit-to-session-input.ts) | `{ sessionId, idempotencyKey, roomToken? }` | 201 |
| [`POST /api/sessions/withdraw`](../api/sessions/withdraw/route.ts) | [`parseWithdrawInput`](./withdrawal-input.ts) | `{ sessionId, idempotencyKey, replacement: { mode: "OPEN_SLOT" } \| { mode: "DIRECT_INVITE", inviteeId } }` | 200 |
| [`POST /api/sessions/replacements/accept`](../api/sessions/replacements/accept/route.ts) | [`parseSessionActionInput`](./withdrawal-input.ts) | `{ sessionId, idempotencyKey }` | 201 |
| [`POST /api/sessions/waitlist/leave`](../api/sessions/waitlist/leave/route.ts) | [`parseSessionActionInput`](./withdrawal-input.ts) | `{ sessionId, idempotencyKey }` | 200 |
| [`POST /api/sessions/attendance`](../api/sessions/attendance/route.ts) | [`parseVerifyAttendanceInput`](./verify-attendance-input.ts) | `{ sessionId, idempotencyKey, marks: [{ participationId, attendance }] }` | 200 |

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

Promotion, forfeiture expiry and auto-verification have no user route; the
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

The cron entry point is
[`GET /api/cron/commitments`](../api/cron/commitments/route.ts). It accepts only
`Authorization: Bearer <CRON_SECRET>`, compared in constant time by
[`isAuthorizedCronRequest`](./cron-auth.ts), and an unset secret authorizes
nothing. Each call invokes `RunScheduledSessionJobs.run` with a new run ID for
up to 25 sessions ([configuration](../../use-case-config/scheduled-jobs.ts)).

[`PostgresDueSessionQuery`](../../lib/commit/postgres-due-session-query.ts)
selects open sessions that have started with a late withdrawal still awaiting
replacement, ended at least 72 hours ago, or have not started and can promote:
a free place after pending personal-invitation reservations, and a queue head
who is not waiting on their own invitation. Sessions that cannot make progress
are never selected, so they cannot fill a batch and starve later sessions.
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
expired. [`createWebPush`](../../lib/commit/web-push.ts) assembles it over the
[`PostgresPushSubscriptionStore`](../../lib/commit/postgres-push-subscription-store.ts)
(`push_subscriptions`, migration 0009, at most 10 browsers per user) and the
[`WebPushSender`](../../lib/commit/web-push-sender.ts) (`web-push`, VAPID,
24-hour TTL). The commitment routes use it when `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set
([`readPushSettings`](./push-environment.ts)); otherwise notifications go to
`NoDeliveryNotifier`.

A browser registers through `POST /api/push/subscriptions` with the
`PushSubscription.toJSON()` body and unregisters with `DELETE` and
`{ endpoint }`; both require a Supabase bearer token and act only on the
caller's own subscriptions. [`push-client.ts`](./push-client.ts) wraps
permission, the [`/sw.js`](../../public/sw.js) service worker and those calls,
and [`PushNotificationsRow`](./_components/push-notifications-row.tsx) is the
Settings toggle. The service worker shows each payload and opens its same-site
URL when clicked.
