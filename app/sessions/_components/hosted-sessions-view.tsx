"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import type { SessionVisibilityActionResult } from "../actions";
import type { HostedSessionItem, HostedSessionsOutcome } from "../types";

export interface HostedSessionsViewProps {
  readonly outcome: HostedSessionsOutcome;
  readonly refreshing: boolean;
  readonly onSetVisibility: (sessionId: string, visibility: "PUBLIC" | "PRIVATE") => Promise<SessionVisibilityActionResult>;
  readonly onRefresh: () => void;
}

export function HostedSessionsView({ outcome, refreshing, onSetVisibility, onRefresh }: HostedSessionsViewProps) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Sessions you host</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Manage the visibility of your upcoming sessions. Public sessions appear in Discover.</p>
      </header>
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
            refreshing={refreshing} onSetVisibility={onSetVisibility} onRefresh={onRefresh} />)}
        </ul>
      )}
    </div>
  );
}

const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});

function HostedSessionCard({ session, refreshing, onSetVisibility, onRefresh }: Omit<HostedSessionsViewProps, "outcome"> & { readonly session: HostedSessionItem }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SessionVisibilityActionResult | null>(null);
  const submitting = useRef(false);
  const full = session.availableSlots === 0;
  const target = session.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC";

  async function changeVisibility() {
    if (submitting.current || refreshing || full) return;
    submitting.current = true;
    setPending(true);
    setResult(null);
    try {
      const saved = await onSetVisibility(session.sessionId, target);
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
          <Button variant="outline" className="min-h-11" disabled={pending || refreshing || full} onClick={changeVisibility}>
            {pending ? "Saving…" : target === "PUBLIC" ? "Make public" : "Make private"}
          </Button>
          {full && <p className="text-sm text-muted-foreground">This session is full. Visibility cannot be changed.</p>}
        </div>
        {result?.status === "error" && <div className="mt-3"><ErrorMessage>{result.message}</ErrorMessage></div>}
        {result?.status === "saved" && result.visibility === session.visibility && <p role="status" className="mt-3 text-sm text-muted-foreground">Session is now {result.visibility.toLowerCase()}.</p>}
      </article>
    </li>
  );
}
