"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import type { SessionVisibilityActionResult } from "../actions";
import type { HostedSessionItem, HostedSessionsOutcome } from "../types";
import { SessionCancellationDialog, type CancellationTransport } from "./session-cancellation-dialog";
import type { SessionCancellationResult } from "@/use-cases/sessions/session-cancellation-transaction";
import { Money } from "@/components/ui/money";
import type { SessionAccountAction, SetSessionVisibilityAction } from "../session-actions";

export interface HostedSessionsViewProps {
  readonly outcome: HostedSessionsOutcome;
  readonly actions: readonly SessionAccountAction[];
  readonly refreshing: boolean;
  readonly onSetVisibility: (sessionId: string, action: SetSessionVisibilityAction) => Promise<SessionVisibilityActionResult>;
  readonly onRefresh: () => void;
  readonly cancellation?: CancellationTransport;
}

/** Renders hosted sessions, an empty state, or a retryable loading error. */
export function HostedSessionsView({ outcome, actions, refreshing, onSetVisibility, onRefresh, cancellation }: HostedSessionsViewProps) {
  const [selected, setSelected] = useState<HostedSessionItem | null>(null);
  const [cancelled, setCancelled] = useState<SessionCancellationResult | null>(null);
  const cancellationTrigger = useRef<HTMLButtonElement | null>(null);
  const creation = actions.find((action) => action.name === "create-session");
  const verification = actions.find((action) => action.name === "verify-email");
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Sessions you host</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Manage your upcoming sessions. Public sessions appear in Discover.</p>
        {creation && <Button asChild className="mt-4 min-h-11"><Link href={creation.href}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Create a session</Link></Button>}
        {verification && <div className="mt-4 space-y-2"><p className="text-sm text-muted-foreground">Verify your email before creating a session.</p><Button asChild variant="outline" className="min-h-11"><Link href={verification.href}>Verify email</Link></Button></div>}
      </header>
      {cancelled && <p role="status" className="mb-4 rounded-lg border p-4">Session cancelled.{" "}
        <Money cents={cancelled.totalRefundCents} /> refunded to {cancelled.refundRecipientCount} participants.</p>}
      {cancellation && <SessionCancellationDialog selected={selected} transport={cancellation}
        onClose={() => setSelected(null)} onRestoreFocus={() => cancellationTrigger.current?.focus()}
        onCancelled={setCancelled} onRefresh={onRefresh} />}
      {outcome.status === "error" ? (
        <div className="space-y-3">
          <ErrorMessage>{outcome.kind === "unavailable" ? "Session management is temporarily unavailable." : "We couldn't load your sessions. Please try again."}</ErrorMessage>
          <Button variant="outline" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Loading…" : "Retry"}</Button>
        </div>
      ) : outcome.sessions.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="No upcoming sessions to manage" description="Your open, upcoming sessions will appear here." />
          <Button asChild variant="outline"><Link href="/discover?returnTo=%2Fsessions">Find a session</Link></Button>
        </div>
      ) : (
        <ul className="space-y-4">
          {outcome.sessions.map((session) => <HostedSessionCard key={session.sessionId} session={session}
            refreshing={refreshing} onSetVisibility={onSetVisibility} onRefresh={onRefresh}
            onCancel={cancellation ? (trigger) => { cancellationTrigger.current = trigger; setSelected(session); } : undefined} />)}
        </ul>
      )}
    </div>
  );
}

const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});

/** Displays confirmed session visibility with capacity guards and per-session save feedback. */
function HostedSessionCard({ session, refreshing, onSetVisibility, onRefresh, onCancel }: Pick<HostedSessionsViewProps, "refreshing" | "onSetVisibility" | "onRefresh"> & { readonly session: HostedSessionItem; readonly onCancel?: (trigger: HTMLButtonElement) => void }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SessionVisibilityActionResult | null>(null);
  const submitting = useRef(false);
  const visibilityAction = session.actions.find((action) => action.name === "set-visibility");
  const cancellationAction = session.actions.find((action) => action.name === "preview-cancellation");

  /** Submits one visibility change at a time and refreshes server state after success or a conflict. */
  async function changeVisibility() {
    if (submitting.current || refreshing || !visibilityAction) return;
    submitting.current = true;
    setPending(true);
    setResult(null);
    try {
      const saved = await onSetVisibility(session.sessionId, visibilityAction);
      setResult(saved);
      if (saved.status === "saved" || saved.refresh) onRefresh();
    } catch {
      setResult({ status: "error", code: "UNEXPECTED_ERROR", message: "We couldn't change visibility. Please try again.", refresh: false });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <li className="rounded-lg border bg-card p-4 shadow-sm md:p-6">
      <article aria-label={`${session.sport} at ${session.venueName}`} className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold">{session.venueName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{session.sport} · {session.region}</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{session.visibility === "PUBLIC" ? "Public" : "Private"}</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground"><time dateTime={session.startAt}>{singaporeDateTime.format(new Date(session.startAt))}</time> – <time dateTime={session.endAt}>{singaporeDateTime.format(new Date(session.endAt))}</time> SGT</p>
        <p className="mt-3 text-sm">{session.visibility === "PUBLIC" ? "Visible in Discover." : "Hidden from Discover."}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="min-h-11"><Link href={`/sessions/${session.sessionId}/participants`}>Manage participants</Link></Button>
          {visibilityAction && <Button variant="outline" className="min-h-11" disabled={pending || refreshing} onClick={changeVisibility}>
            {pending ? "Saving…" : visibilityAction.inputs.visibility === "PUBLIC" ? "Make public" : "Make private"}
          </Button>}
          {onCancel && cancellationAction && <Button variant="destructive" className="min-h-11" disabled={pending || refreshing} onClick={(event) => onCancel(event.currentTarget)}>Cancel session</Button>}
          {!visibilityAction && <p className="text-sm text-muted-foreground">Visibility cannot be changed for this session.</p>}
        </div>
        {result?.status === "error" && <div className="mt-3"><ErrorMessage>{result.message}</ErrorMessage></div>}
        {result?.status === "saved" && result.visibility === session.visibility && <p role="status" className="mt-3 text-sm text-muted-foreground">Session is now {result.visibility.toLowerCase()}.</p>}
      </article>
    </li>
  );
}
