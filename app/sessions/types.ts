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
  readonly actions: readonly HostedSessionAction[];
}

/** UC2-06: an ended hosted session whose attendance the booker still needs to check. */
export interface AttendanceDueItem {
  readonly sessionId: string;
  readonly venueName: string;
  readonly sport: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly unverifiedCount: number;
}

export type HostedSessionsOutcome =
  | { readonly status: "ready"; readonly sessions: readonly HostedSessionItem[]; readonly awaitingAttendance?: readonly AttendanceDueItem[] }
  | { readonly status: "error"; readonly kind: "unavailable" | "unexpected" };
import type { HostedSessionAction } from "./session-actions";
