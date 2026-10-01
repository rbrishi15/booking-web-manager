"use client";

import { useState } from "react";
import { buildDiscoveryQuery, parseDiscoveryQuery, type DiscoveryFilters } from "../query";
import { deriveDiscoveryState, type DiscoveryOutcome, type ValidationFeedback } from "./discovery-state";
import { DiscoveryView } from "./discovery-view";

export interface DiscoveryFormControllerProps {
  readonly filters: DiscoveryFilters;
  readonly outcome: DiscoveryOutcome;
  readonly pending: boolean;
  readonly onNavigate: (query: string) => void;
  readonly onRefresh: () => void;
}

/** Local transitions, shared with Storybook; navigation and server outcomes are supplied by its parent. */
export function DiscoveryFormController({ filters, outcome, pending, onNavigate, onRefresh }: DiscoveryFormControllerProps) {
  const [feedback, setFeedback] = useState<ValidationFeedback>({ status: "idle" });
  const state = deriveDiscoveryState(outcome, pending, feedback);

  function navigate(query: string) {
    if (pending) return;
    setFeedback({ status: "idle" });
    onNavigate(query);
  }

  function apply(formData: FormData) {
    if (pending) return;
    const params = new URLSearchParams();
    for (const field of ["sport", "region", "date", "timeFrom", "timeTo"] as const) {
      const value = formData.get(field);
      if (typeof value === "string" && value !== "") params.set(field, value);
    }
    const parsed = parseDiscoveryQuery(params);
    if (parsed.status === "invalid") {
      setFeedback({ status: "invalid", fieldErrors: parsed.fieldErrors });
      return;
    }
    navigate(buildDiscoveryQuery(parsed.filters));
  }

  return (
    <DiscoveryView
      filters={filters}
      state={state}
      onApply={apply}
      onEdit={() => setFeedback({ status: "idle" })}
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
