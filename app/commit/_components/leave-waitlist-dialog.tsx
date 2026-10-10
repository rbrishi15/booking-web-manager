"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import type { LeaveWaitlistState } from "../use-leave-waitlist-flow";
import { singaporeStart } from "./joined-session-format";

/** UC2-05 leave the waitlist, display only: one controlled dialog driven by `useLeaveWaitlistFlow`. */
export function LeaveWaitlistDialog({ state, onConfirm, onClose }: {
  readonly state: LeaveWaitlistState;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  if (state.step === "closed") return <Dialog open={false} />;
  const { session, submitting, unresolved } = state;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave the waitlist?</DialogTitle>
          <DialogDescription>
            {session.sport} at {session.venueName}, <time dateTime={session.startAt}>{singaporeStart.format(new Date(session.startAt))}</time> (Singapore time).
            {" "}Nothing is held for a waitlist place, so no money moves. You lose your place in the queue.
          </DialogDescription>
        </DialogHeader>
        {state.error !== null && <ErrorMessage>{state.error}</ErrorMessage>}
        {unresolved && state.error === null && (
          <ErrorMessage>Your last request to leave wasn&apos;t confirmed. Retry it to finish; the same request is reused.</ErrorMessage>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {/* After an unresolved request the player may already have left, so don't promise they stay. */}
          <Button type="button" variant="outline" className="min-h-11" disabled={submitting} onClick={onClose}>
            {unresolved ? "Retry later" : "Stay on the waitlist"}
          </Button>
          <Button type="button" variant="destructive" className="min-h-11" disabled={submitting} onClick={onConfirm}>
            {submitting ? "Leaving…" : unresolved ? "Retry leaving" : "Leave waitlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
