import type { UUID } from "@/domain";
import type {
  PromoteFromWaitlist,
  PromoteFromWaitlistResult,
} from "./PromoteFromWaitlist";

/** What happened to the waitlist after a place may have opened. */
export type FollowUpPromotion =
  | { readonly status: "NOT_NEEDED" }
  | { readonly status: "COMPLETED"; readonly result: PromoteFromWaitlistResult }
  /** Promotion failed; the caller's change is kept and a sweep retries it. */
  | { readonly status: "DEFERRED" };

/**
 * Runs waitlist promotion in its own unit of work after the caller's change
 * has committed, keyed by the caller's request so a retried request replays
 * the same promotion. A promotion failure must not undo a withdrawal that
 * already committed, so it is reported as DEFERRED; the scheduled promotion
 * sweep fills the place later.
 */
export async function promoteAfter(
  promote: Pick<PromoteFromWaitlist, "forSession">,
  sessionId: UUID,
  triggerKey: string,
): Promise<FollowUpPromotion> {
  try {
    const result = await promote.forSession({ sessionId, triggerKey });
    return { status: "COMPLETED", result };
  } catch {
    return { status: "DEFERRED" };
  }
}
