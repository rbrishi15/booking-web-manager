"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { DiscoveryFilters } from "../query";
import { DiscoveryFormController } from "./discovery-form-controller";
import type { DiscoveryOutcome } from "./discovery-state";

/** The URL owns committed filters and paging; React tracks only navigation and draft validation. */
export function DiscoveryController({ filters, outcome, queryKey }: {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly queryKey: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DiscoveryFormController
      key={queryKey}
      filters={filters}
      outcome={outcome}
      pending={pending}
      onNavigate={(query) => startTransition(() => {
        if (query === queryKey) router.refresh();
        else router.push(query === "" ? "/discover" : `/discover?${query}`);
      })}
      onRefresh={() => startTransition(() => router.refresh())}
    />
  );
}
