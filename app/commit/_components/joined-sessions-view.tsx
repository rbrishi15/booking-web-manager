import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/status-badge";
import type { JoinedSessionItem, LeaveWaitlist, PreviewWithdrawal, ReplacementCandidate, WithdrawFromSession } from "../withdrawal-ports";
import { singaporeStart } from "./joined-session-format";
import { LeaveWaitlistButton } from "./leave-waitlist-button";
import { WithdrawButton } from "./withdraw-button";

/** The list, still loading, loaded, or failed. */
export type JoinedSessionsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly sessions: readonly JoinedSessionItem[] }
  | { readonly status: "error"; readonly message: string };

/** What the Withdraw and Leave-waitlist buttons call; supplied by the page (fakes in stories). */
export interface JoinedSessionActions {
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  readonly leaveWaitlist: LeaveWaitlist;
  readonly candidates: readonly ReplacementCandidate[];
  /** Called after a withdrawal or waitlist departure, to reload the list. */
  readonly onChanged: () => void;
}

export interface JoinedSessionsViewProps {
  readonly state: JoinedSessionsState;
  readonly onRetry: () => void;
  readonly actions: JoinedSessionActions;
}

/**
 * UC2-05: the sessions the player holds a place in or is waiting for, each with its way out.
 * Display only: it receives the list and the actions as props and fetches nothing itself.
 */
export function JoinedSessionsView({ state, onRetry, actions }: JoinedSessionsViewProps) {
  return (
    <section aria-labelledby="joined-heading" className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
      <header className="mb-6">
        <h1 id="joined-heading" className="text-2xl font-bold tracking-tight md:text-3xl">Sessions you&apos;ve joined</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Withdraw from a session or leave a waitlist. You&apos;ll see what you get back before anything happens.
        </p>
      </header>

      {state.status === "loading" && <LoadingSpinner label="Loading your sessions…" />}
      {state.status === "error" && (
        <div className="space-y-3">
          <ErrorMessage>{state.message}</ErrorMessage>
          <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>Retry</Button>
        </div>
      )}
      {state.status === "ready" && state.sessions.length === 0 && (
        <EmptyState title="You haven't joined any sessions" description="Sessions you join or wait for appear here."
          action={<Button asChild className="min-h-11"><Link href="/discover">Find a session</Link></Button>} />
      )}
      {state.status === "ready" && state.sessions.length > 0 && (
        <ul aria-label="Joined sessions" className="space-y-3">
          {state.sessions.map((session) => (
            <li key={session.sessionId} className="rounded-lg border bg-card p-4 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-lg font-semibold">{session.venueName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {session.sport} · {session.region} · <time dateTime={session.startAt}>{singaporeStart.format(new Date(session.startAt))}</time> SGT
                  </p>
                </div>
                {session.status === "COMMITTED"
                  ? <StatusBadge tone="success">You have a place</StatusBadge>
                  : <StatusBadge tone="info">On the waitlist</StatusBadge>}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {session.status === "COMMITTED"
                    ? <><Money cents={session.bookingShareCents} className="font-semibold text-foreground" /> held from your wallet</>
                    : "Nothing held until a place opens"}
                </p>
                {session.status === "COMMITTED"
                  ? <WithdrawButton session={session} previewWithdrawal={actions.previewWithdrawal} withdraw={actions.withdraw}
                      candidates={actions.candidates} onWithdrawn={actions.onChanged} />
                  : <LeaveWaitlistButton session={session} leaveWaitlist={actions.leaveWaitlist} onLeft={actions.onChanged} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
