"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { executeSessionVisibility, loadCancellationPreview, executeSessionCancellation } from "../session-action-transport";
import type { SessionAccountAction } from "../session-actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

/** Follows advertised HTTP actions and refreshes the displayed session state after execution. */
export function HostedSessionsController({ outcome, userId, actions }: { readonly outcome: HostedSessionsOutcome; readonly userId: string; readonly actions: readonly SessionAccountAction[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startTransition] = useTransition();
  return <>
    {params.get("created") === "1" && <p role="status" className="mx-auto mt-5 max-w-5xl px-6 text-sm text-success md:px-8">Your session was created successfully.</p>}
    <HostedSessionsView key={userId} outcome={outcome} actions={actions} refreshing={refreshing} onSetVisibility={(_sessionId, action) => executeSessionVisibility(action)}
      cancellation={{ userId, preview: loadCancellationPreview, cancel: executeSessionCancellation }}
      onRefresh={() => startTransition(() => router.refresh())} />
  </>;
}
