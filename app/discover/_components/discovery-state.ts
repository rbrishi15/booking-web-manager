import type { DiscoveryPage } from "../contracts";
import type { DiscoveryFieldErrors } from "../query";

/** Each screen can represent exactly one outcome; empty and pagination are derived from data. */
export type DiscoveryState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly page: DiscoveryPage }
  | { readonly status: "invalid"; readonly fieldErrors: DiscoveryFieldErrors }
  | { readonly status: "error"; readonly kind: "unavailable" | "unexpected" };

export type DiscoveryOutcome = Exclude<DiscoveryState, { readonly status: "loading" }>;

export type ValidationFeedback =
  | { readonly status: "idle" }
  | { readonly status: "invalid"; readonly fieldErrors: DiscoveryFieldErrors };

/** URL/server data remain authoritative; local feedback exists only until edit or navigation. */
export function deriveDiscoveryState(
  outcome: DiscoveryOutcome,
  pending: boolean,
  feedback: ValidationFeedback,
): DiscoveryState {
  if (pending) return { status: "loading" };
  if (feedback.status === "invalid") return feedback;
  return outcome;
}
