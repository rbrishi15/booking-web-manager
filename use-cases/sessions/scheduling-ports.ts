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
