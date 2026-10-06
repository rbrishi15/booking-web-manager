"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";
import type { SessionParticipantsOutcome } from "../removal-actions";
import { ParticipantRemovalDialog, type ParticipantRemovalTransport, type RemovalResult, type RemovalTarget } from "./participant-removal-dialog";

export interface SessionParticipantsViewProps {
  readonly sessionId: string;
  readonly outcome: SessionParticipantsOutcome;
  readonly refreshing: boolean;
  readonly removal: ParticipantRemovalTransport;
  readonly onRefresh: () => void;
}

const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});
const statusLabels = {
  COMMITTED: "Committed", WAITLISTED: "Waitlisted", LEFT_WAITLIST: "Left waitlist",
  WITHDRAWN: "Withdrawn", REMOVED: "Removed", CANCELLED: "Cancelled",
} as const;

/** Preserves participant-list order and terminal history while keeping refund results visible across refreshes. */
export function SessionParticipantsView({ sessionId, outcome, refreshing, removal, onRefresh }: SessionParticipantsViewProps) {
  const [selected, setSelected] = useState<RemovalTarget | null>(null);
  const [removed, setRemoved] = useState<ReadonlyMap<string, RemovalResult>>(new Map());
  const [success, setSuccess] = useState<{ result: RemovalResult; displayName: string } | null>(null);
  const [recoveryLocked, setRecoveryLocked] = useState(true);
  const [started, setStarted] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const session = outcome.status === "ready" ? outcome.session : null;
  const startAt = session?.startAt;

  useEffect(() => {
    if (!startAt) return;
    // Hide stale removal controls at the start boundary; the server owns the actual time guard.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const remaining = new Date(startAt).getTime() - Date.now();
      setStarted(remaining <= 0);
      if (remaining > 0) timer = setTimeout(update, Math.min(remaining, 2_147_483_647));
    };
    update();
    return () => clearTimeout(timer);
  }, [startAt]);

  const availableSlots = session ? session.availableSlots + session.participants.filter((participant) =>
    participant.status === "COMMITTED" && removed.has(participant.participationId)).length : 0;

  function restoreFocus() {
    if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
    else heading.current?.focus();
  }

  return <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
    <Button asChild variant="outline" className="mb-6"><Link href="/sessions">Back to hosted sessions</Link></Button>
    <header className="mb-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-offset-4 md:text-3xl">Manage participants</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">View your participant list and refund removed participants.</p>
    </header>
    {success && <p role="status" className="mb-4 break-words rounded-lg border p-4">
      {success.displayName} removed. <Money cents={success.result.refundCents} /> refunded to their in-app wallet.
    </p>}
    <ParticipantRemovalDialog sessionId={sessionId} selected={selected} transport={removal}
      onClose={() => setSelected(null)} onRestoreFocus={restoreFocus}
      onRemoved={(result, displayName) => {
        setRemoved((previous) => new Map(previous).set(result.participationId, result));
        setSuccess({ result, displayName });
      }}
      onRefresh={onRefresh} onRecoveryChange={setRecoveryLocked} />
    {outcome.status === "error" ? <div className="space-y-3">
      <ErrorMessage>{outcome.message}</ErrorMessage>
      <Button variant="outline" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Loading…" : "Retry"}</Button>
    </div> : session && <>
      <section aria-label="Session details" className="mb-6 rounded-lg border bg-card p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">{session.venueName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{session.sport}</p>
          </div>
          <Badge variant="secondary">{session.status.charAt(0) + session.status.slice(1).toLowerCase()}</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <time dateTime={session.startAt}>{singaporeDateTime.format(new Date(session.startAt))}</time>
          {" – "}<time dateTime={session.endAt}>{singaporeDateTime.format(new Date(session.endAt))}</time> SGT
        </p>
        <p className="mt-3 text-sm">{availableSlots} {availableSlots === 1 ? "slot" : "slots"} available</p>
        {(session.status !== "OPEN" || started) && <p className="mt-2 text-sm text-muted-foreground">Participants can only be removed before an open session starts. Records remain available below.</p>}
      </section>
      <section aria-labelledby="participant-list-heading">
        <h2 id="participant-list-heading" className="mb-3 text-lg font-semibold">Participants ({session.participants.length})</h2>
        {session.participants.length === 0 ? <EmptyState title="No participants yet" description="Participants will appear here when they join this session." />
          : <ul aria-label="Participants" className="space-y-3">
            {session.participants.map((participant) => {
              const status = removed.has(participant.participationId) ? "REMOVED" : participant.status;
              return <li key={participant.participationId} className="rounded-lg border bg-card p-4">
                <article aria-label={participant.displayName} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-medium">{participant.displayName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{statusLabels[status]}</p>
                  </div>
                  {status === "COMMITTED" && participant.canRemove && session.status === "OPEN" && !started && <Button
                    variant="outline" className="min-h-11" disabled={refreshing || recoveryLocked}
                    aria-label={`Remove ${participant.displayName}`} onClick={(event) => { trigger.current = event.currentTarget; setSelected(participant); }}>
                    Remove participant
                  </Button>}
                </article>
              </li>;
            })}
          </ul>}
        {session.participants.some((participant) => participant.status === "WAITLISTED") && <p className="mt-4 text-sm text-muted-foreground">Waitlist order is preserved. Removing a participant does not automatically promote someone from the waitlist.</p>}
      </section>
    </>}
  </div>;
}
