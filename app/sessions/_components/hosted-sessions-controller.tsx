"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setSessionVisibility } from "../actions";
import type { HostedSessionsOutcome } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";

export function HostedSessionsController({ outcome }: { readonly outcome: HostedSessionsOutcome }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <HostedSessionsView outcome={outcome} refreshing={refreshing} onSetVisibility={setSessionVisibility}
    onRefresh={() => startTransition(() => router.refresh())} />;
}
