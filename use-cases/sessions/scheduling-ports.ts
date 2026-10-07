import type { UUID } from "@/domain";

/**
 * Finds sessions that may have time-triggered commitment work due: a free
 * place with people waiting, a started session with late withdrawals still
 * awaiting replacement, or an open session 72 hours past its end.
 *
 * Returning a superset is safe: every job re-checks its own rule inside its
 * unit of work and does nothing when not due. The adapter should select with
 * `FOR UPDATE SKIP LOCKED` (or an equivalent lease) so concurrent sweepers
 * take different sessions; correctness does not depend on it, because each
 * job's unit of work locks the session row itself.
 */
export interface DueSessionQuery {
  dueSessionIds(now: Date, limit: number): Promise<readonly UUID[]>;
}

export interface VerificationReminder {
  readonly sessionId: UUID;
  readonly bookerId: UUID;
}

/**
 * Claims sessions whose booker should be reminded to verify attendance: the
 * session has ended, is still open for verification, and has not been
 * reminded. Claiming marks the reminder as sent in the same statement (for
 * example `UPDATE ... SET verification_reminded_at = now ... RETURNING`), so
 * each booker is reminded at most once per session even across concurrent
 * or repeated sweeps. If handing the reminders to the notifier fails, the
 * sweep releases its claims so a later run retries them. A reminder accepted
 * by the notifier but not delivered to a device is not retried.
 */
export interface VerificationReminderQuery {
  claimVerificationReminders(
    now: Date,
    limit: number,
  ): Promise<readonly VerificationReminder[]>;
  /** Clears the sent mark for claimed reminders that could not be handed off. */
  releaseVerificationReminders(sessionIds: readonly UUID[]): Promise<void>;
}
