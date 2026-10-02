/** Browser-safe fields for sessions hosted by the authenticated booker. */
export interface HostedSessionItem {
  readonly sessionId: string;
  readonly venueName: string;
  readonly sport: string;
  readonly region: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly visibility: "PUBLIC" | "PRIVATE";
  readonly availableSlots: number;
}

export type HostedSessionsOutcome =
  | { readonly status: "ready"; readonly sessions: readonly HostedSessionItem[] }
  | { readonly status: "error"; readonly kind: "unavailable" | "unexpected" };
