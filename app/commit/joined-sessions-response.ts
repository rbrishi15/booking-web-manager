import type { JoinedSession } from "@/use-cases/sessions/ListJoinedSessions";
import type { JoinedSessionsResponse } from "./joined-sessions-contract";

/** Server-side mapping of the use-case result into the GET /api/sessions/joined contract. */
export function toJoinedSessionsResponse(sessions: readonly JoinedSession[]): JoinedSessionsResponse {
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport, region: session.region,
      startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(),
      status: session.status, bookingShareCents: session.bookingShareCents,
    })),
  };
}
