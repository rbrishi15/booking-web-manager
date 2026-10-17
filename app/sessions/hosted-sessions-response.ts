import type { HostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import type { HostedSessionsResponse } from "./hosted-sessions-contract";
import { toHostedSessionActions } from "./session-actions";

/** Server-side mapping of the use-case results into the GET /api/sessions/hosted contract. */
export function toHostedSessionsResponse({ sessions, awaitingAttendance }: HostedSessions): HostedSessionsResponse {
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      region: session.region, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(),
      visibility: session.visibility, availableSlots: session.availableSlots,
      actions: [...toHostedSessionActions(session.sessionId, session.actions)],
    })),
    awaitingAttendance: awaitingAttendance.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), unverifiedCount: session.unverifiedCount,
    })),
  };
}
