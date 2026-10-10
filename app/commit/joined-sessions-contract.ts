import { z } from "zod";

/**
 * GET /api/sessions/joined response contract, shared by the route, its OpenAPI document and
 * the browser. It has no server code, so the browser imports only this schema and its type.
 */
const timestamp = z.string().datetime({ offset: true });

export const joinedSessionsResponseSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string().uuid(),
    venueName: z.string(),
    sport: z.string(),
    region: z.string(),
    startAt: timestamp,
    endAt: timestamp,
    /** COMMITTED can withdraw (POST /api/sessions/withdraw); WAITLISTED can leave (POST /api/sessions/waitlist/leave). */
    status: z.enum(["COMMITTED", "WAITLISTED"]),
    /** The session's per-slot share in integer cents; held only while COMMITTED. */
    bookingShareCents: z.number().int().nonnegative(),
  })),
});

export type JoinedSessionsResponse = z.infer<typeof joinedSessionsResponseSchema>;
