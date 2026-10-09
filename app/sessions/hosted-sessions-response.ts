import { z } from "zod";
import type { AttendanceDueSession, HostedSession } from "@/use-cases/sessions/ListHostedSessions";
import { toHostedSessionActions } from "./session-actions";
import type { AttendanceDueItem, HostedSessionItem } from "./types";

/**
 * GET /api/sessions/hosted response: the booker's upcoming hosted sessions with their
 * advertised actions, and ended sessions still awaiting the booker's attendance check (UC2-06).
 * The same schema documents the route and validates the reply in the browser.
 */
const actionSchema = z.object({
  name: z.enum(["set-visibility", "preview-cancellation"]),
  href: z.string().min(1),
  method: z.enum(["PATCH", "GET"]),
  inputs: z.union([z.object({ visibility: z.enum(["PUBLIC", "PRIVATE"]) }), z.object({}).strict()]),
});

export const hostedSessionsResponseSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string().min(1),
    venueName: z.string(),
    sport: z.string(),
    region: z.string(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    availableSlots: z.number().int().nonnegative(),
    actions: z.array(actionSchema),
  })),
  awaitingAttendance: z.array(z.object({
    sessionId: z.string().min(1),
    venueName: z.string(),
    sport: z.string(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    unverifiedCount: z.number().int().positive(),
  })),
});

export interface HostedSessionsResponse {
  readonly sessions: readonly HostedSessionItem[];
  readonly awaitingAttendance: readonly AttendanceDueItem[];
}

/** Serializes the use-case results into the browser-safe response. */
export function toHostedSessionsResponse(sessions: readonly HostedSession[], attendanceDue: readonly AttendanceDueSession[]): HostedSessionsResponse {
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      region: session.region, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(),
      visibility: session.visibility, availableSlots: session.availableSlots,
      actions: toHostedSessionActions(session.sessionId, session.actions),
    })),
    awaitingAttendance: attendanceDue.map((session) => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
      startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), unverifiedCount: session.unverifiedCount,
    })),
  };
}
