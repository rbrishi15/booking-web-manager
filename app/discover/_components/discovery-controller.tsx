"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { DiscoveryFilters } from "../query";
import { discoveryHref } from "../navigation";
import { DiscoveryFormController } from "./discovery-form-controller";
import type { DiscoveryOutcome } from "./discovery-state";
import { startDiscoveryPolling, type DiscoveryPolling } from "./discovery-polling";

/** The URL owns committed filters and paging; React tracks only navigation and draft validation. */
export function DiscoveryController({ filters, outcome, queryKey, returnTo }: {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly queryKey: string;
  readonly returnTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // React can batch transitions. Explicit user intent alone enables the loading UI.
  const [foreground, setForeground] = useState(false);
  const conditions = useRef({ valid: outcome.status !== "invalid", busy: false });
  const polling = useRef<DiscoveryPolling | null>(null);

  useEffect(() => {
    const refreshes = startDiscoveryPolling({
      refresh: () => startTransition(() => router.refresh()),
      canRefresh: () => conditions.current.valid && !conditions.current.busy,
      document, window, online: () => navigator.onLine,
    });
    polling.current = refreshes;
    return () => { refreshes.stop(); polling.current = null; };
  }, [router, queryKey]);

  useEffect(() => {
    conditions.current = { valid: outcome.status !== "invalid", busy: pending || foreground };
    if (!pending) {
      polling.current?.complete();
      setForeground(false);
    }
  }, [outcome.status, pending, foreground]);

  function navigate(query?: string) {
    setForeground(true);
    startTransition(() => {
      if (query === undefined || query === queryKey) router.refresh();
      else router.push(discoveryHref(query, returnTo));
    });
  }

  return (
    <DiscoveryFormController
      key={queryKey}
      filters={filters}
      outcome={outcome}
      pending={pending && foreground}
      returnTo={returnTo}
      onNavigate={navigate}
      onRefresh={() => navigate()}
    />
  );
}
