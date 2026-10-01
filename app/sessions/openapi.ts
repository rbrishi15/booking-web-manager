import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { createSessionRequestSchema } from "./create-session-input";
import { SESSION_API_UNAVAILABLE_MESSAGE } from "./session-api-unavailable";

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

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "The integrated authenticator must verify the bearer token and current ACTIVE account on every request. Body identity fields are ignored. Authentication integration is pending.",
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
    "Production authentication and persistence integration are pending; the current endpoint returns 503 SESSION_API_UNAVAILABLE for every request.",
    "The following contract applies once those dependencies are integrated.",
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
    503: errorResponse("Session creation is intentionally unavailable while authentication and persistence integration are pending.", "SESSION_API_UNAVAILABLE", SESSION_API_UNAVAILABLE_MESSAGE),
  },
});

/** Public metadata only: no environment reads or server credentials. */
export const sessionOpenApiDocument = new OpenApiGeneratorV3(registry.definitions)
  .generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Booking Web Manager API",
      version: "1.0.0",
      description: "Session and venue coordination API contract. Production authentication and persistence integration are pending; session creation currently returns 503.",
    },
    servers: [{ url: "/", description: "This server" }],
  });
