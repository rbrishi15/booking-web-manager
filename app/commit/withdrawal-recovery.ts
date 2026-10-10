import { z } from "zod";
import type { JoinedSessionItem, WithdrawRequest, WithdrawalPreview } from "./withdrawal-ports";

/**
 * Rules for UC2-05 requests whose outcome is unknown ("unresolved"): a withdrawal or waitlist
 * departure that may or may not have happened. Plain functions, so they are unit-tested in CI.
 *
 * Recovery strategy:
 * 1. An unresolved request is kept per user and session, and saved in this browser, so it
 *    survives a reload (`UnresolvedStore`).
 * 2. It is only ever retried exactly, with the same idempotency key, so the server replays the
 *    original result instead of acting twice.
 * 3. It is cleared only when its outcome is established: the retry succeeds, or the server's
 *    joined-sessions list shows the place has gone (`reconcile`). A retry that fails, including
 *    for an expired login, never clears it.
 */

/** A withdrawal that may have happened, with the refund the player was shown for it. */
export interface UnresolvedWithdrawal {
  readonly request: WithdrawRequest;
  readonly preview: WithdrawalPreview;
}

/** What one attempt established. */
export type AttemptOutcome = "succeeded" | "unconfirmed" | "rejected";

/**
 * The unresolved requests after an attempt. A first attempt that the server rejects proves it
 * did nothing; a failed retry proves nothing about the earlier attempt, so that entry stays.
 */
export function settleAttempt<T>(
  unresolved: ReadonlyMap<string, T>,
  sessionId: string,
  entry: T,
  outcome: AttemptOutcome,
  wasRetry: boolean,
): ReadonlyMap<string, T> {
  if (outcome === "succeeded") return without(unresolved, sessionId);
  if (outcome === "unconfirmed" || wasRetry) return unresolved.get(sessionId) === entry ? unresolved : new Map(unresolved).set(sessionId, entry);
  return without(unresolved, sessionId);
}

/**
 * Clears unresolved requests whose outcome the server's joined-sessions list establishes: the
 * place is no longer listed with the status the request would have changed (it was withdrawn,
 * left, or the session ended). While it is still listed, the request stays and can be retried.
 * Returns the same map when nothing changes.
 */
export function reconcile<T>(
  unresolved: ReadonlyMap<string, T>,
  sessions: readonly JoinedSessionItem[] | undefined,
  status: JoinedSessionItem["status"],
): ReadonlyMap<string, T> {
  if (sessions === undefined) return unresolved;
  let next = unresolved;
  for (const sessionId of unresolved.keys()) {
    if (!sessions.some((session) => session.sessionId === sessionId && session.status === status)) next = without(next, sessionId);
  }
  return next;
}

/** Whether the refund the server reports now differs from the one the player was shown. */
export function termsDiffer(shown: WithdrawalPreview, latest: WithdrawalPreview): boolean {
  return shown.kind !== latest.kind || shown.refundCents !== latest.refundCents || shown.heldCents !== latest.heldCents;
}

function without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Where unresolved requests are kept between page loads. */
export interface UnresolvedStore<T> {
  readonly load: () => ReadonlyMap<string, T>;
  readonly save: (unresolved: ReadonlyMap<string, T>) => void;
}

const cents = z.number().int().safe().nonnegative();
const previewSchema = z.object({ kind: z.enum(["REFUNDED", "AWAITING_REPLACEMENT"]), refundCents: cents, heldCents: cents });
const replacementSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("OPEN_SLOT") }),
  z.object({ mode: z.literal("DIRECT_INVITE"), inviteeId: z.string().min(1) }),
]);
export const unresolvedWithdrawalSchema: z.ZodType<UnresolvedWithdrawal> = z.object({
  request: z.object({ sessionId: z.string().min(1), idempotencyKey: z.string().min(1), replacement: replacementSchema }),
  preview: previewSchema,
});
/** An unresolved waitlist departure is just its idempotency key. */
export const unresolvedDepartureSchema: z.ZodType<string> = z.string().min(1);

/**
 * Keeps one user's unresolved requests in `localStorage`, under a key that includes their user
 * ID, so another account in the same browser never sees or replays them. Saved data is validated
 * on load; unreadable data or unavailable storage falls back to an empty map, never an error.
 */
export function browserUnresolvedStore<T>(
  kind: "withdrawals" | "waitlist-departures",
  userId: string,
  schema: z.ZodType<T>,
  storage: () => Storage | undefined = () => (typeof window === "undefined" ? undefined : window.localStorage),
): UnresolvedStore<T> {
  const key = `booking-web-manager:unresolved-${kind}:${userId}`;
  return {
    load: () => {
      try {
        const raw = storage()?.getItem(key);
        if (!raw) return new Map();
        const parsed = z.record(z.string(), schema).safeParse(JSON.parse(raw));
        return parsed.success ? new Map(Object.entries(parsed.data)) : new Map();
      } catch {
        return new Map();
      }
    },
    save: (unresolved) => {
      try {
        if (unresolved.size === 0) storage()?.removeItem(key);
        else storage()?.setItem(key, JSON.stringify(Object.fromEntries(unresolved)));
      } catch {
        // Storage can be full or blocked; the request is still kept for this page.
      }
    },
  };
}

/** A store that keeps nothing between page loads; for stories and tests. */
export function memoryUnresolvedStore<T>(initial: ReadonlyMap<string, T> = new Map()): UnresolvedStore<T> & { saved: () => ReadonlyMap<string, T> } {
  let current = initial;
  return { load: () => current, save: (unresolved) => { current = unresolved; }, saved: () => current };
}
