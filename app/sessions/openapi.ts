import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { createSessionRequestSchema } from "./create-session-input";
import { SESSION_API_UNAVAILABLE_MESSAGE } from "./session-api-unavailable";

export function registerSessionApi(registry: OpenAPIRegistry): void {
  const requestSchema = registry.register("CreateSessionRequest", createSessionRequestSchema);
  const resultSchema = registry.register("CreateSessionResult", z.object({
    sessionId: z.string().uuid(),
    roomToken: z.string(),
    bookingShareCents: z.number().int().nonnegative().safe(),
  }));

  registry.registerPath({
    method: "post",
    path: "/api/sessions",
    operationId: "createSession",
    tags: ["Sessions"],
    summary: "UC2-02 Create Session",
    description: [
      "Requires configured Supabase and PostgreSQL settings and migrations through 0008_session_pricing; missing settings return 503 SESSION_API_UNAVAILABLE.",
      "Creates a booking room for the authenticated booker at an already-booked venue.",
      "Omitted config.pricePerSlotCents defaults to floor(totalCostCents / totalSlots).",
      "For suggestion s, chosen price must be between max(1, ceil(s / 2)) and min(2 * s, floor(MAX_SAFE_INTEGER / totalSlots)), inclusive. All amounts are safe integer cents.",
      "bookingShareCents is the validated immutable chosen price. Collection may be below or above booking cost; 1001 cents across 3 slots defaults to 333 cents each, leaving 2 cents with the booker.",
      "A completed payout account and active account are required. Visibility defaults to PRIVATE.",
      "Use the same idempotencyKey to retry a submission: the original result is replayed,",
      "even when valid booking details change. Use a new key for a new session; keys are isolated per booker.",
      "Current account authorization is checked before every successful replay; creation-specific payout and booking-time rules are not repeated for a replay.",
      "Booking timestamps are ISO strings with Z or a timezone offset. Unknown fields are ignored.",
      "Blank venue names, nonpositive cost, invalid time order, capacity outside 2–8,",
      "or reliability outside 0–100 are domain errors (422),",
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
              config: { totalSlots: 3 },
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
}
