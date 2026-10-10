"use client";

import { useRef, useState } from "react";
import type { JoinedSessionItem, LeaveWaitlist } from "./withdrawal-ports";

/** Everything the leave-waitlist dialog shows. `closed` means no dialog. */
export type LeaveWaitlistState =
  | { readonly step: "closed" }
  | { readonly step: "confirming"; readonly session: JoinedSessionItem; readonly submitting: boolean; readonly error: string | null };

export interface LeaveWaitlistFlow {
  readonly state: LeaveWaitlistState;
  readonly start: (session: JoinedSessionItem) => void;
  readonly confirm: () => void;
  readonly close: () => void;
}

/**
 * UC2-05 leave-the-waitlist interaction state, for one dialog shared by every session. After an
 * unconfirmed result the session's idempotency key is kept, so a retry can only replay it.
 */
export function useLeaveWaitlistFlow({ leaveWaitlist, onLeft }: {
  readonly leaveWaitlist: LeaveWaitlist;
  /** Called after leaving, to reload the player's sessions. */
  readonly onLeft: () => void;
}): LeaveWaitlistFlow {
  const [state, setState] = useState<LeaveWaitlistState>({ step: "closed" });
  /** Idempotency keys of unconfirmed departures, by session. */
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);

  async function confirm() {
    if (busy.current || state.step !== "confirming") return;
    const { session } = state;
    const idempotencyKey = keys.current.get(session.sessionId) ?? crypto.randomUUID();
    keys.current.set(session.sessionId, idempotencyKey);
    busy.current = true;
    setState({ ...state, submitting: true, error: null });
    let result: Awaited<ReturnType<LeaveWaitlist>>;
    try {
      result = await leaveWaitlist({ sessionId: session.sessionId, idempotencyKey });
    } catch {
      result = { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you left the waitlist. Try again: the same request is reused.", unconfirmed: true };
    } finally {
      busy.current = false;
    }
    if (result.status === "left") {
      keys.current.delete(session.sessionId);
      setState({ step: "closed" });
      onLeft();
      return;
    }
    if (!result.unconfirmed) keys.current.delete(session.sessionId);
    setState({ step: "confirming", session, submitting: false, error: result.message });
  }

  return {
    state,
    start: (session) => setState({ step: "confirming", session, submitting: false, error: null }),
    confirm: () => { void confirm(); },
    close: () => { if (!busy.current) setState({ step: "closed" }); },
  };
}
