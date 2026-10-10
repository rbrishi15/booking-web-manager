import { z } from "zod";

/**
 * GET /api/sessions/hosted response contract, shared by the route, its OpenAPI document and the
 * browser. It has no server code, so the browser imports only this schema and its types.
 */
const visibility = z.enum(["PUBLIC", "PRIVATE"]);
const timestamp = z.string().datetime({ offset: true });

/** Each action allows exactly one method and input shape, matching `HostedSessionAction`. */
export const hostedSessionActionSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("set-visibility"), href: z.string().min(1), method: z.literal("PATCH"), inputs: z.object({ visibility }).strict() }),
  z.object({ name: z.literal("preview-cancellation"), href: z.string().min(1), method: z.literal("GET"), inputs: z.object({}).strict() }),
]);

export const hostedSessionsResponseSchema = z.object({
  /** The booker's OPEN, upcoming hosted sessions, each with the actions allowed now. */
  sessions: z.array(z.object({
    sessionId: z.string().min(1),
    venueName: z.string(),
    sport: z.string(),
    region: z.string(),
    startAt: timestamp,
    endAt: timestamp,
    visibility,
    availableSlots: z.number().int().nonnegative(),
    actions: z.array(hostedSessionActionSchema),
  })),
  /** UC2-06: ended sessions with committed players whose attendance is still unchecked. */
  awaitingAttendance: z.array(z.object({
    sessionId: z.string().min(1),
    venueName: z.string(),
    sport: z.string(),
    startAt: timestamp,
    endAt: timestamp,
    unverifiedCount: z.number().int().positive(),
  })),
});

/** What the browser's validation establishes, so no type assertion is needed after parsing. */
export type HostedSessionsResponse = z.infer<typeof hostedSessionsResponseSchema>;
