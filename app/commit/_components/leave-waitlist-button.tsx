"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { JoinedSessionItem, LeaveWaitlist } from "../withdrawal-ports";
import { singaporeStart } from "./joined-session-format";

/**
 * UC2-05 leave the waitlist. No money moves, so there is no amount to show. After an
 * unconfirmed result the same idempotency key is kept, so a retry can only replay it.
 */
export function LeaveWaitlistButton({ session, leaveWaitlist, onLeft }: {
  readonly session: JoinedSessionItem;
  readonly leaveWaitlist: LeaveWaitlist;
  /** Called after leaving, to reload the player's sessions. */
  readonly onLeft: () => void;
}) {
  const idempotencyKey = useRef<string | null>(null);

  async function leave() {
    idempotencyKey.current ??= crypto.randomUUID();
    let result: Awaited<ReturnType<LeaveWaitlist>>;
    try {
      result = await leaveWaitlist({ sessionId: session.sessionId, idempotencyKey: idempotencyKey.current });
    } catch {
      throw new Error("We couldn't confirm whether you left the waitlist. Try again: the same request is reused.");
    }
    if (result.status === "error") {
      if (!result.unconfirmed) idempotencyKey.current = null;
      throw new Error(result.message);
    }
    idempotencyKey.current = null;
    onLeft();
  }

  return (
    <ConfirmDialog
      trigger={<Button type="button" variant="outline" className="min-h-11" aria-label={`Leave the waitlist for ${session.sport} at ${session.venueName}`}>Leave waitlist</Button>}
      title="Leave the waitlist?"
      description={<>
        {session.sport} at {session.venueName}, <time dateTime={session.startAt}>{singaporeStart.format(new Date(session.startAt))}</time> (Singapore time).
        {" "}Nothing is held for a waitlist place, so no money moves. You lose your place in the queue.
      </>}
      confirmLabel="Leave waitlist"
      destructive
      onConfirm={leave}
    />
  );
}
