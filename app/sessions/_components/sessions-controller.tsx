"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { SessionFeedLoadError, loadSessionFeed as defaultLoadFeed, type LoadSessionFeed } from "../session-feed-transport";
import type { SessionFeedItem } from "../session-feed-contract";
import type { SessionAccountAction } from "../session-actions";
import { HostedSessionsLoadError, loadHostedSessions as defaultLoadHosted, type LoadHostedSessions } from "../hosted-sessions-transport";
import { executeSessionCancellation, executeSessionVisibility, loadCancellationPreview } from "../session-action-transport";
import { HostedSessionControls } from "./hosted-sessions-view";
import { SessionCancellationDialog } from "./session-cancellation-dialog";
import type { HostedSessionItem } from "../types";
import type { SessionCancellationResult } from "@/use-cases/sessions/session-cancellation-transaction";
import { hostedSessionsQueryKey } from "./hosted-sessions-controller";
import { SessionsView } from "./sessions-view";
import { SessionsUiProvider, useSessionsUiStore } from "./sessions-ui-provider";
import { createSessionsUrlStorage, readSessionsUrlState } from "./sessions-url-storage";
import { sessionCanLeave, sessionStatus, sessionVenueLabel } from "./session-display";
import styles from "./sessions.module.css";
import details from "./session-details.module.css";
import { SessionDetailsSummary } from "./session-details-summary";
import { JoinedSessionDetails } from "./joined-session-details";
import joined from "./joined-session-details.module.css";
import { SessionControlsSkeleton } from "./sessions-skeleton";

export const sessionFeedQueryKey = ["sessions", "feed"] as const;

interface SessionsControllerProps {
  readonly userId: string;
  readonly actions: readonly SessionAccountAction[];
  readonly loadFeed?: LoadSessionFeed;
  readonly loadHosted?: LoadHostedSessions;
}

/** A new account gets fresh UI state; React Query owns the account-scoped feed. */
export function SessionsController(props: SessionsControllerProps) {
  const params = useSearchParams();
  const initialTab = readSessionsUrlState(params).tab;
  const [account, setAccount] = useState({ id: props.userId, resetSelection: false });
  if (account.id !== props.userId) setAccount({ id: props.userId, resetSelection: true });
  const storage = useMemo(() => createSessionsUrlStorage(
    () => new URL(window.location.href),
    (url) => {
      const historyState = { ...window.history.state };
      // Let Next's history wrapper synchronize useSearchParams and reattach its
      // routing markers, while retaining other consumers' history metadata.
      delete historyState.__NA;
      delete historyState._N;
      window.history.replaceState(historyState, "", `${url.pathname}${url.search}${url.hash}`);
    },
  ), []);
  return <SessionsUiProvider key={props.userId} initialTab={initialTab} persistence={{ storage, search: params.toString(), resetSelection: account.resetSelection }}><SessionsContent {...props} /></SessionsUiProvider>;
}

/** Loading another page retains already loaded cards. */
function SessionsContent({ userId, actions, loadFeed = defaultLoadFeed, loadHosted = defaultLoadHosted }: SessionsControllerProps) {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tab = useSessionsUiStore((state) => state.tab);
  const setTab = useSessionsUiStore((state) => state.selectTab);
  const mode = useSessionsUiStore((state) => state.mode);
  const openSession = useSessionsUiStore((state) => state.openSession);
  const closeSession = useSessionsUiStore((state) => state.closeSession);
  const activeSessionId = useSessionsUiStore((state) => state.activeSessionId);
  const scrollTargetId = useSessionsUiStore((state) => state.scrollTargetId);
  const clearTimelineSession = useSessionsUiStore((state) => state.clearTimelineSession);
  const finishUrlRestoration = useSessionsUiStore((state) => state.finishUrlRestoration);
  const [missingSelection, setMissingSelection] = useState(false);
  useEffect(() => {
    if (activeSessionId !== null || tab === "hosting") setMissingSelection(false);
  }, [activeSessionId, tab]);
  const [cancelling, setCancelling] = useState<HostedSessionItem | null>(null);
  const [cancelled, setCancelled] = useState<SessionCancellationResult | null>(null);
  const cancellationTrigger = useRef<HTMLButtonElement | null>(null);
  const sessionTrigger = useRef<HTMLElement | null>(null);
  const [lastOpenedSession, setLastOpenedSession] = useState<SessionFeedItem | null>(null);
  const feed = useInfiniteQuery({
    queryKey: [...sessionFeedQueryKey, userId, tab],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadFeed({ tab, cursor: pageParam, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const sessions = useMemo(() => {
    const unique = new Map<string, SessionFeedItem>();
    for (const page of feed.data?.pages ?? []) for (const session of page.sessions) unique.set(session.sessionId, session);
    return Array.from(unique.values());
  }, [feed.data]);
  const restoringSelection = tab === "joined" && activeSessionId !== null && !sessions.some((session) => session.sessionId === activeSessionId);
  useEffect(() => {
    if (!restoringSelection || !feed.isSuccess || feed.isFetching) return;
    if (feed.hasNextPage) {
      void feed.fetchNextPage();
    } else {
      setMissingSelection(true);
      clearTimelineSession();
    }
  }, [restoringSelection, feed.isSuccess, feed.isFetching, feed.hasNextPage, feed.fetchNextPage, clearTimelineSession]);
  const selected = mode.status === "viewingSession" ? sessions.find((session) => session.sessionId === mode.sessionId) ?? null : null;
  useEffect(() => {
    // A completed refresh can remove a session. Pending/failed requests must not
    // discard the user's selection, and an old ID must not reopen on a later refresh.
    if (feed.isSuccess && !feed.isFetching && mode.status === "viewingSession" && !selected) closeSession();
  }, [feed.isSuccess, feed.isFetching, mode, selected, closeSession]);
  // Retain the visible content while Radix finishes the closing animation.
  const dialogSession = selected ?? lastOpenedSession;
  const first = feed.data?.pages[0];
  const signIn = feed.error instanceof SessionFeedLoadError && feed.error.signIn;
  const loginPath = feed.error instanceof SessionFeedLoadError && feed.error.code === "UNAUTHENTICATED" ? "/login?next=%2Fsessions" : "/login";
  useEffect(() => { if (signIn) router.replace(loginPath); }, [signIn, loginPath, router]);
  const loadMore = useCallback(() => { if (feed.hasNextPage && !feed.isFetching) void feed.fetchNextPage(); }, [feed.hasNextPage, feed.isFetching, feed.fetchNextPage]);
  const retry = () => { if (feed.isFetchNextPageError) void feed.fetchNextPage(); else void feed.refetch(); };
  const refresh = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: sessionFeedQueryKey });
    void queryClient.invalidateQueries({ queryKey: hostedSessionsQueryKey });
  };
  return <>
    {params.get("created") === "1" && <p role="status" className="px-6 pt-4 text-sm text-success md:px-10">Your session was created successfully.</p>}
    {cancelled && <p role="status" className="px-6 pt-4 text-sm md:px-10">Session cancelled. <Money cents={cancelled.totalRefundCents} /> refunded to {cancelled.refundRecipientCount} participants.</p>}
    {restoringSelection && <p role="status" className="px-6 pt-4 text-sm md:px-10">{feed.isError ? "The selected session could not be loaded." : "Loading the selected session…"} <button type="button" className="underline" onClick={clearTimelineSession}>Show all sessions</button></p>}
    {missingSelection && <p role="status" className="px-6 pt-4 text-sm md:px-10">This session is no longer available in your joined sessions.</p>}
    <SessionsView tab={tab} onTabChange={(next) => {
      setTab(next);
      setMissingSelection(false);
    }} sessions={restoringSelection && feed.isError ? [] : sessions} asOf={first?.asOf ?? new Date().toISOString()} upcomingCount={first?.upcomingCount ?? 0} pastCount={first?.pastCount ?? 0} actions={actions}
      scrollTargetId={scrollTargetId} onUrlRestored={finishUrlRestoration}
      loading={feed.isPending || signIn || (restoringSelection && !feed.isError)} error={!signIn && feed.isError ? feed.error instanceof SessionFeedLoadError && feed.error.kind === "unavailable" ? "Your sessions are temporarily unavailable." : "We couldn’t load your sessions. Please try again." : undefined}
      loadingMore={feed.isFetchingNextPage} hasMore={feed.hasNextPage} onLoadMore={loadMore} onRetry={retry} onOpenSession={(session) => { setLastOpenedSession(session); sessionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; openSession(session.sessionId); }} />
    <Dialog open={mode.status === "viewingSession" && selected !== null} onOpenChange={(open) => { if (!open) closeSession(); }}>
      <DialogContent overlayClassName={dialogSession?.role === "HOST" ? details.overlay : joined.overlay} className={dialogSession?.role === "HOST" ? `${styles.dialogContent} ${details.dialog}` : joined.dialog} onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (sessionTrigger.current?.isConnected) sessionTrigger.current.focus({ preventScroll: true });
        else document.getElementById("sessions-heading")?.focus({ preventScroll: true });
      }}>
        {dialogSession && <>
          {dialogSession.role === "HOST" && <button type="button" className={details.sheetHandle} aria-label="Dismiss session details" onClick={closeSession}><span aria-hidden /></button>}
          {dialogSession.role === "HOST" ? <DialogHeader className={details.header}>
            <p className={details.eyebrow}>Sessions / {dialogSession.section === "upcoming" ? "Organising" : "Hosted"}</p>
            <div className={details.titleRow}><DialogTitle className={details.title}>{dialogSession.sport} session</DialogTitle>
            </div>
            <DialogDescription className={details.subtitle}><a href={`https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${dialogSession.venueName}, Singapore` })}`} target="_blank" rel="noreferrer">{sessionVenueLabel(dialogSession.venueName)}<span className="sr-only"> (opens in a new tab)</span></a>{dialogSession.section === "past" && <span> · {sessionStatus(dialogSession)}</span>}</DialogDescription>
          </DialogHeader> : null}
          {dialogSession.role === "HOST" ? <>
            <SessionDetailsSummary session={dialogSession} />
            <HostedSessionManagement userId={userId} session={dialogSession} loadHosted={loadHosted} onRefresh={refresh} onCancel={(session, trigger) => { cancellationTrigger.current = trigger; setCancelling(session); }} />
          </> : <JoinedSessionDetails session={dialogSession} userId={userId} canLeave={sessionCanLeave(dialogSession, first?.asOf ?? new Date().toISOString())} onRefresh={refresh} />}
        </>}
      </DialogContent>
    </Dialog>
    <SessionCancellationDialog selected={cancelling} transport={{ userId, preview: loadCancellationPreview, cancel: executeSessionCancellation }}
      onClose={() => setCancelling(null)} onRestoreFocus={() => {
        if (cancellationTrigger.current?.isConnected) cancellationTrigger.current.focus();
        else document.getElementById("sessions-heading")?.focus();
      }} onCancelled={(result) => { setCancelled(result); closeSession(); }} onRefresh={refresh} />
  </>;
}

function HostedSessionManagement({ userId, session, loadHosted, onRefresh, onCancel }: { readonly userId: string; readonly session: SessionFeedItem; readonly loadHosted: LoadHostedSessions; readonly onRefresh: () => void; readonly onCancel: (session: HostedSessionItem, trigger: HTMLButtonElement) => void }) {
  const query = useQuery({ queryKey: [...hostedSessionsQueryKey, userId], queryFn: ({ signal }) => loadHosted(signal), retry: false });
  if (query.isPending) return <SessionControlsSkeleton />;
  if (query.isError) return <div className="space-y-4"><p role="alert">{query.error instanceof HostedSessionsLoadError && query.error.signIn ? "Your sign-in has expired. Sign in again to manage this session." : "We couldn’t load session controls."}</p>{query.error instanceof HostedSessionsLoadError && query.error.signIn ? <Link href="/login?next=%2Fsessions" className={styles.primaryButton}>Sign in</Link> : <button className={styles.secondaryButton} onClick={() => void query.refetch()}>Try again</button>}</div>;
  const managed = query.data.sessions.find((item) => item.sessionId === session.sessionId);
  const attendance = query.data.awaitingAttendance.find((item) => item.sessionId === session.sessionId);
  if (managed) return <HostedSessionControls session={managed} refreshing={query.isFetching}
    participants={{ participantCount: session.participantCount, capacity: session.capacity }}
    onSetVisibility={(_id, action) => executeSessionVisibility(action)} onRefresh={onRefresh}
    onCancel={(trigger) => onCancel(managed, trigger)} />;
  return <div className={details.row}>
    <div><h3>Participants</h3><p>{attendance ? `${attendance.unverifiedCount} players to check` : `${session.participantCount} of ${session.capacity} players joined`}</p></div>
    <Link className={`${styles.secondaryButton} ${details.quietButton}`} href={`/sessions/${session.sessionId}/participants`}>{attendance ? "Check attendance" : "View participants"}</Link>
  </div>;
}
