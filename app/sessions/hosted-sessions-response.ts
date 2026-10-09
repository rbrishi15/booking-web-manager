import type { UUID } from "@/domain";
import type { AttendanceDueSession, HostedSession, ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import type { HostedSessionsResponse } from "./hosted-sessions-contract";
import { toHostedSessionActions } from "./session-actions";

/** Server-side mapping of the use-case results into the GET /api/sessions/hosted contract. */
export function toHostedSessionsResponse(sessions: readonly HostedSession[], attendanceDue: readonly AttendanceDueSession[]): HostedSessionsResponse {
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      region: session.region, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(),
      visibility: session.visibility, availableSlots: session.availableSlots,
      actions: [...toHostedSessionActions(session.sessionId, session.actions)],
    })),
    awaitingAttendance: attendanceDue.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), unverifiedCount: session.unverifiedCount,
    })),
  };
}

/** Reads both lists for the booker. A failure of either is reported, never replaced by an empty list. */
export async function readHostedSessions(
  listHostedSessions: Pick<ListHostedSessions, "forBooker" | "attendanceDueForBooker">,
  bookerId: UUID,
): Promise<HostedSessionsResponse> {
  const [sessions, attendanceDue] = await Promise.all([
    listHostedSessions.forBooker(bookerId),
    listHostedSessions.attendanceDueForBooker(bookerId),
  ]);
  return toHostedSessionsResponse(sessions, attendanceDue);
}
