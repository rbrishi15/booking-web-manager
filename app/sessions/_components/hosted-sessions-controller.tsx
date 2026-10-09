"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { HostedSessionsLoadError, loadHostedSessions as defaultLoadHostedSessions, type LoadHostedSessions } from "../hosted-sessions-transport";
import { executeSessionVisibility, loadCancellationPreview, executeSessionCancellation } from "../session-action-transport";
import type { SessionAccountAction } from "../session-actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

export const hostedSessionsQueryKey = ["sessions", "hosted"] as const;

/**
 * Loads the booker's sessions through GET /api/sessions/hosted (React Query), follows advertised
 * HTTP actions, and refetches after each change. An expired login or inactive account goes to login.
 */
export function HostedSessionsController({ userId, actions, loadHostedSessions = defaultLoadHostedSessions }: {
  readonly userId: string;
  readonly actions: readonly SessionAccountAction[];
  /** Injected in stories and tests; production calls the API. */
  readonly loadHostedSessions?: LoadHostedSessions;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const hosted = useQuery({ queryKey: [...hostedSessionsQueryKey, userId], queryFn: ({ signal }) => loadHostedSessions(signal) });

  const signIn = hosted.error instanceof HostedSessionsLoadError && hosted.error.signIn;
  // An expired login returns here after signing in; an inactive or missing account does not.
  const loginPath = hosted.error instanceof HostedSessionsLoadError && hosted.error.code === "UNAUTHENTICATED" ? "/login?next=%2Fsessions" : "/login";
  useEffect(() => { if (signIn) router.replace(loginPath); }, [signIn, loginPath, router]);

  if (hosted.isPending || signIn) return <div className="mx-auto max-w-5xl px-6 pt-10 md:px-8"><LoadingSpinner label="Loading your sessions…" /></div>;

  const outcome: HostedSessionsOutcome = hosted.isError && hosted.data === undefined
    ? { status: "error", kind: hosted.error instanceof HostedSessionsLoadError ? hosted.error.kind : "unexpected" }
    : { status: "ready", sessions: hosted.data!.sessions, awaitingAttendance: hosted.data!.awaitingAttendance };

  return <>
    {params.get("created") === "1" && <p role="status" className="mx-auto mt-5 max-w-5xl px-6 text-sm text-success md:px-8">Your session was created successfully.</p>}
    <HostedSessionsView key={userId} outcome={outcome} actions={actions} refreshing={hosted.isFetching} onSetVisibility={(_sessionId, action) => executeSessionVisibility(action)}
      cancellation={{ userId, preview: loadCancellationPreview, cancel: executeSessionCancellation }}
      onRefresh={() => { void queryClient.invalidateQueries({ queryKey: hostedSessionsQueryKey }); }} />
  </>;
}
