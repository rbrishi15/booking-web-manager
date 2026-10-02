"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { setSessionVisibility } from "../actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

export function HostedSessionsController({ outcome }: { readonly outcome: HostedSessionsOutcome }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startTransition] = useTransition();
  return <>
    {params.get("created") === "1" && <p role="status" className="mx-auto mt-5 max-w-5xl px-6 text-sm text-success md:px-8">Your session was created successfully.</p>}
    <HostedSessionsView outcome={outcome} refreshing={refreshing} onSetVisibility={setSessionVisibility}
      onRefresh={() => startTransition(() => router.refresh())} />
  </>;
}
