"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setSessionVisibility } from "../actions";
import { previewSessionCancellation, cancelSession } from "../cancellation-actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

/** Connects hosted-session controls to the server action and tracks router refresh progress. */
export function HostedSessionsController({ outcome, userId }: { readonly outcome: HostedSessionsOutcome; readonly userId: string }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <HostedSessionsView key={userId} outcome={outcome} refreshing={refreshing} onSetVisibility={setSessionVisibility}
    cancellation={{ userId, preview: previewSessionCancellation, cancel: cancelSession }}
    onRefresh={() => startTransition(() => router.refresh())} />;
}
