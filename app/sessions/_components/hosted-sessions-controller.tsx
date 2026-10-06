"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { setSessionVisibility } from "../actions";
import { previewSessionCancellation, cancelSession } from "../cancellation-actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

/** Connects hosted-session controls to the server action and tracks router refresh progress. */
export function HostedSessionsController({ outcome, userId }: { readonly outcome: HostedSessionsOutcome; readonly userId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startTransition] = useTransition();
  return <>
    {params.get("created") === "1" && <p role="status" className="mx-auto mt-5 max-w-5xl px-6 text-sm text-success md:px-8">Your session was created successfully.</p>}
    <HostedSessionsView key={userId} outcome={outcome} refreshing={refreshing} onSetVisibility={setSessionVisibility}
      cancellation={{ userId, preview: previewSessionCancellation, cancel: cancelSession }}
      onRefresh={() => startTransition(() => router.refresh())} />
  </>;
}
