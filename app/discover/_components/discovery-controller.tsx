"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { DiscoveryFilters } from "../query";
import { discoveryHref } from "../navigation";
import { DiscoveryFormController } from "./discovery-form-controller";
import type { DiscoveryOutcome } from "./discovery-state";

/** The URL owns committed filters and paging; React tracks only navigation and draft validation. */
export function DiscoveryController({ filters, outcome, queryKey, returnTo }: {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly queryKey: string;
  readonly returnTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DiscoveryFormController
      key={queryKey}
      filters={filters}
      outcome={outcome}
      pending={pending}
      returnTo={returnTo}
      onNavigate={(query) => startTransition(() => {
        if (query === queryKey) router.refresh();
        else router.push(discoveryHref(query, returnTo));
      })}
      onRefresh={() => startTransition(() => router.refresh())}
    />
  );
}
