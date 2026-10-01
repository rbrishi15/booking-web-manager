import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { createSessionRequestSchema } from "./create-session-input";
import { SESSION_API_UNAVAILABLE_MESSAGE } from "./session-api-unavailable";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const requestSchema = registry.register("CreateSessionRequest", createSessionRequestSchema);
const resultSchema = registry.register("CreateSessionResult", z.object({
  sessionId: z.string().uuid(),
  roomToken: z.string(),
  bookingShareCents: z.number().int().nonnegative().safe(),
}));
const errorSchema = registry.register("ApiError", z.object({
  error: z.object({ code: z.string(), message: z.string() }),
}));
const discoveryResultSchema = registry.register("DiscoverSessionsResult", z.object({
  items: z.array(z.object({
    sessionId: z.string().uuid(),
    venueName: z.string(),
    region: z.string(),
    sport: z.string(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    totalSlots: z.number().int().min(1).max(8),
    bookingShareCents: z.number().int().positive().safe(),
  })).max(20),
  nextCursor: z.string().nullable(),
}));
const discoveryExample = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  venueName: "Jurong East Sports Hall",
  region: "West",
  sport: "Badminton",
  startAt: "2040-01-02T10:00:00.000Z",
  endAt: "2040-01-02T12:00:00.000Z",
  totalSlots: 3,
  bookingShareCents: 333,
};
const discoveryCursorExample = Buffer.from(JSON.stringify({
  startAt: discoveryExample.startAt,
  sessionId: "11111111-1111-4111-8111-000000000020",
})).toString("base64url");

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Supabase verifies the bearer token and current ACTIVE account on every request, including replay. Body identity fields are ignored.",
});

function errorResponse(description: string, code: string, message: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: errorSchema,
        example: { error: { code, message } },
      },
    },
  };
}

registry.registerPath({
  method: "post",
  path: "/api/sessions",
  operationId: "createSession",
  tags: ["Sessions"],
  summary: "UC2-02 Create Session",
  description: [
    "Requires configured Supabase and PostgreSQL settings and migrations through 0006_session_creation; missing settings return 503 SESSION_API_UNAVAILABLE.",
    "Creates a booking room for the authenticated booker at an already-booked venue.",
    "The server calculates bookingShareCents as floor(totalCostCents / totalSlots).",
    "The booker covers the rounding remainder: 1001 cents across 3 slots means 333 cents each and 2 cents remaining with the booker.",
    "A completed payout account and active account are required. Visibility defaults to PRIVATE.",
    "Use the same idempotencyKey to retry a submission: the original result is replayed,",
    "even when valid booking details change. Use a new key for a new session; keys are isolated per booker.",
    "Current account authorization is checked before every successful replay; creation-specific payout and booking-time rules are not repeated for a replay.",
    "Booking timestamps are ISO strings with Z or a timezone offset. Unknown fields are ignored.",
    "Blank venue names, nonpositive cost, invalid time order, capacity outside 1–8,",
    "invalid minimum headcount, or reliability outside 0–100 are domain errors (422),",
    "while malformed JSON and structural errors return 400. No funds move during creation.",
  ].join(" "),
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: requestSchema,
          example: {
            idempotencyKey: "first-booking-room",
            booking: {
              venueName: "Jurong East Sports Hall",
              region: "West",
              sport: "Badminton",
              startAt: "2030-10-01T18:00:00+08:00",
              endAt: "2030-10-01T20:00:00+08:00",
              totalCostCents: 1001,
            },
            config: { totalSlots: 3, minimumHeadcount: 2 },
          },
        },
      },
    },
  },
  responses: {
    201: {
      description: "Session created, or the original successful submission replayed.",
      content: { "application/json": { schema: resultSchema } },
    },
    400: errorResponse("Malformed JSON or structurally invalid request.", "INVALID_REQUEST", "Invalid session creation request"),
    401: errorResponse("Missing, invalid, or expired bearer token.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("Inactive account or unauthorized action.", "INACTIVE_ACCOUNT", "An inactive booker cannot create a session"),
    404: errorResponse("The authenticated user has no domain account.", "NOT_FOUND", "User was not found"),
    409: errorResponse("Incomplete payout setup or session already started.", "PAYOUT_ACCOUNT_NOT_READY", "A session needs a completed payout account"),
    422: errorResponse("Structurally valid values violate domain rules.", "INVALID_INPUT", "Invalid session details"),
    500: errorResponse("Unexpected authentication, configuration, or persistence failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
    503: errorResponse("Required session server settings are missing.", "SESSION_API_UNAVAILABLE", SESSION_API_UNAVAILABLE_MESSAGE),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sessions",
  operationId: "discoverSessions",
  tags: ["Sessions"],
  summary: "UC2-01 Discover Sessions",
  description: [
    "Lists upcoming PUBLIC, OPEN sessions for an authenticated active account, including full sessions.",
    "Only sessions starting strictly after the server clock are returned; minimum reliability and current capacity do not hide listings.",
    "Optional sport and region filters use the shared profile vocabulary. Regions are the stored booking regions; OneMap resolution is separate work.",
    "Date and time filters use Asia/Singapore (UTC+08:00) and match session starts in a lower-inclusive, upper-exclusive window.",
    "A date alone covers that whole Singapore calendar day. timeFrom or timeTo requires date; omitted bounds default to the start or end of that day.",
    "The lower time must precede the upper time. Blank values are omitted, duplicate known parameters are rejected, and unknown parameters are ignored.",
    "Results are ordered by startAt then sessionId, with at most 20 items per page. Pass the opaque nextCursor unchanged with the same filters for the next page; null means the final page.",
    "The response contains listing fields only, never room tokens or participant, wallet, holding-account, payout, or invitation data. totalSlots is capacity, not remaining availability.",
    "Responses use Cache-Control: no-store. Missing settings return 503 DISCOVERY_API_UNAVAILABLE.",
  ].join(" "),
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      sport: z.enum(SPORTS).optional(),
      region: z.enum(REGIONS).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({
        description: "A valid Singapore calendar date in YYYY-MM-DD form.",
        example: "2040-01-02",
      }),
      timeFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().openapi({
        description: "Inclusive Singapore start time (HH:mm); requires date.",
        example: "18:00",
      }),
      timeTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().openapi({
        description: "Exclusive Singapore start time (HH:mm); requires date.",
        example: "20:00",
      }),
      cursor: z.string().optional().openapi({
        description: "Opaque nextCursor from the preceding response, with unchanged filters.",
        example: discoveryCursorExample,
      }),
    }),
  },
  responses: {
    200: {
      description: "A page of public session listings, or an empty result. All responses use Cache-Control: no-store.",
      headers: { "Cache-Control": { schema: { type: "string", enum: ["no-store"] } } },
      content: {
        "application/json": {
          schema: discoveryResultSchema,
          examples: {
            populated: { summary: "A final page with one session", value: { items: [discoveryExample], nextCursor: null } },
            empty: { summary: "No matching sessions", value: { items: [], nextCursor: null } },
            pagination: {
              summary: "A page with more sessions available",
              value: {
                items: Array.from({ length: 20 }, (_, index) => ({
                  ...discoveryExample,
                  sessionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                })),
                nextCursor: discoveryCursorExample,
              },
            },
          },
        },
      },
    },
    400: errorResponse("Malformed or duplicate filters, invalid calendar date/time range, or invalid cursor.", "INVALID_REQUEST", "Invalid session discovery query"),
    401: errorResponse("Missing, invalid, or expired bearer token.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("The authenticated account is inactive.", "INACTIVE_ACCOUNT", "An inactive account cannot use the session API"),
    404: errorResponse("The authenticated user has no domain account.", "NOT_FOUND", "User was not found"),
    500: errorResponse("Unexpected authentication, configuration, or persistence failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
    503: errorResponse("Required discovery server settings are missing.", "DISCOVERY_API_UNAVAILABLE", "Session discovery is not available yet"),
  },
});

/** Public metadata only: no environment reads or server credentials. */
export const sessionOpenApiDocument = new OpenApiGeneratorV3(registry.definitions)
  .generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Booking Web Manager API",
      version: "1.0.0",
      description: "Session and venue coordination API. Session creation and discovery verify Supabase bearer tokens and current active accounts; missing settings return 503. Creation persists atomically in PostgreSQL, and discovery exposes public listing fields only.",
    },
    servers: [{ url: "/", description: "This server" }],
  });
