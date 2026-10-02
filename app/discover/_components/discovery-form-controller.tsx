"use client";

import { useState } from "react";
import { buildDiscoveryQuery, parseDiscoveryQuery, type DiscoveryFilters } from "../query";
import { deriveDiscoveryState, type DiscoveryOutcome, type FilterPanelState, type ValidationFeedback } from "./discovery-state";
import { DiscoverySearchView } from "./discovery-search-view";

export interface DiscoveryFormControllerProps {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly pending: boolean;
  readonly onNavigate: (query: string) => void;
  readonly onRefresh: () => void;
  readonly returnTo?: string;
}

/** Local transitions, shared with Storybook; navigation and server outcomes are supplied by its parent. */
export function DiscoveryFormController({ filters, outcome, pending, onNavigate, onRefresh, returnTo }: DiscoveryFormControllerProps) {
  const [feedback, setFeedback] = useState<ValidationFeedback>({ status: "idle" });
  const [filterPanel, setFilterPanel] = useState<FilterPanelState>(outcome.status === "invalid" ? "expanded" : "collapsed");
  const state = deriveDiscoveryState(outcome, pending, feedback);

  function navigate(query: string) {
    if (pending) return;
    setFeedback({ status: "idle" });
    onNavigate(query);
  }

  function apply(formData: FormData) {
    if (pending) return;
    const params = new URLSearchParams();
    for (const field of ["q", "sport", "region", "date", "timeFrom", "timeTo"] as const) {
      const value = formData.get(field);
      if (typeof value === "string" && value !== "") params.set(field, value);
    }
    const parsed = parseDiscoveryQuery(params);
    if (parsed.status === "invalid") {
      setFilterPanel("expanded");
      setFeedback({ status: "invalid", fieldErrors: parsed.fieldErrors });
      return;
    }
    navigate(buildDiscoveryQuery(parsed.filters));
  }

  return (
    <DiscoverySearchView
      returnTo={returnTo}
      filters={filters}
      state={state}
      filterPanel={state.status === "invalid" ? "expanded" : filterPanel}
      onToggleFilters={() => {
        if (!pending) setFilterPanel((panel) => panel === "collapsed" ? "expanded" : "collapsed");
      }}
      onApply={apply}
      onEdit={() => {
        setFeedback({ status: "idle" });
      }}
      onClear={() => navigate("")}
      onNext={(cursor) => navigate(buildDiscoveryQuery(filters, cursor))}
      onRetry={() => {
        if (pending) return;
        setFeedback({ status: "idle" });
        onRefresh();
      }}
    />
  );
}
