"use client";

import { useState } from "react";
import { buildDiscoveryQuery, parseDiscoveryQuery, type DiscoveryFilters } from "../query";
import { deriveDiscoveryState, type DiscoveryOutcome, type FilterPanelState, type ValidationFeedback } from "./discovery-state";
import { DiscoveryView } from "./discovery-view";
import { DiscoverySearchView } from "./discovery-search-view";

export interface DiscoveryFormControllerProps {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly pending: boolean;
  readonly onNavigate: (query: string) => void;
  readonly onRefresh: () => void;
  readonly presentation?: "home" | "search";
  readonly returnTo?: string;
}

/** Local transitions, shared with Storybook; navigation and server outcomes are supplied by its parent. */
export function DiscoveryFormController({ filters, outcome, pending, onNavigate, onRefresh, presentation = "home", returnTo }: DiscoveryFormControllerProps) {
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

  const View = presentation === "search" ? DiscoverySearchView : DiscoveryView;
  return (
    <View
      returnTo={returnTo}
      filters={filters}
      state={state}
      filterPanel={state.status === "invalid" ? "expanded" : filterPanel}
      onToggleFilters={() => {
        if (!pending) setFilterPanel((panel) => panel === "collapsed" ? "expanded" : "collapsed");
      }}
      onApply={apply}
      onEdit={() => {
        if (presentation === "home") setFilterPanel("expanded");
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
