import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { sessionVisibilityParamsSchema, sessionVisibilityRequestSchema } from "./visibility-input";
import { SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE } from "./session-management-unavailable";
import { hostedSessionsResponseSchema } from "./hosted-sessions-contract";

/** Registers the hosted-sessions GET and visibility PATCH operations, their schemas, and documented error responses. */
export function registerSessionManagementApi(registry: OpenAPIRegistry): void {
  const hosted = registry.register("HostedSessions", hostedSessionsResponseSchema);
  registry.registerPath({
    method: "get",
    path: "/api/sessions/hosted",
    operationId: "listHostedSessions",
    tags: ["Sessions"],
    summary: "UC2-03 / UC2-06 List the booker's hosted sessions",
    description: "Requires an active authenticated booker. Returns their OPEN, upcoming hosted sessions in start order, each with the actions the booker may take now (`set-visibility`, `preview-cancellation`), and their ended OPEN sessions that still have unverified committed participants (`awaitingAttendance`). Read-only; no money moves. Identity comes from the bearer token or, when no `Authorization` header is sent, from the Supabase login cookies sent by this site's pages.",
    security: [{ bearerAuth: [] }, { loginCookie: [] }],
    responses: {
      200: { description: "The booker's hosted sessions and sessions awaiting attendance.", content: { "application/json": { schema: hosted } } },
      401: errorResponse("Missing, invalid or expired bearer token.", "UNAUTHENTICATED", "Authentication is required"),
      403: errorResponse("Inactive account.", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions"),
      404: errorResponse("The authenticated user has no account.", "NOT_FOUND", "User was not found"),
      500: errorResponse("Unexpected infrastructure failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse("Required server settings are missing.", "SESSION_MANAGEMENT_UNAVAILABLE", SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE),
    },
  });
  const request = registry.register("SessionVisibilityRequest", sessionVisibilityRequestSchema);
  const result = registry.register("SessionVisibilityResult", z.object({ sessionId: z.string().uuid(), visibility: z.enum(["PUBLIC", "PRIVATE"]) }));
  registry.registerPath({
    method: "patch",
    path: "/api/sessions/{sessionId}/visibility",
    operationId: "setSessionVisibility",
    tags: ["Sessions"],
    summary: "UC2-03a Set session visibility",
    description: "Requires an active authenticated owner and an OPEN, upcoming session with available capacity, including personal replacement reservations. Sets an explicit PUBLIC or PRIVATE target; repeat requests recheck all restrictions even when unchanged. Returns only after commit. No money moves or replay key is required. Requires configured Supabase/PostgreSQL and migrations through 0007. Visible, online discovery pages refresh automatically within three seconds under healthy service conditions. Unknown body fields are ignored; identity always comes from the bearer token.",
    security: [{ bearerAuth: [] }],
    request: { params: sessionVisibilityParamsSchema, body: { required: true, content: { "application/json": { schema: request, example: { visibility: "PUBLIC" } } } } },
    responses: {
      200: { description: "Committed visibility, including a checked same-value request.", content: { "application/json": { schema: result } } },
      400: errorResponse("Malformed JSON, session ID or visibility.", "INVALID_REQUEST", "Invalid session visibility request"),
      401: errorResponse("Missing, invalid or expired bearer token.", "UNAUTHENTICATED", "Authentication is required"),
      403: errorResponse("Inactive account or a session owned by another booker.", "UNAUTHORIZED", "Only the booker can manage this session"),
      404: errorResponse("User or session does not exist.", "NOT_FOUND", "Session was not found"),
      409: errorResponse("Session is full, started or closed.", "CAPACITY_EXCEEDED", "Visibility cannot change after the session is full"),
      500: errorResponse("Unexpected infrastructure failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse("Required server settings are missing.", "SESSION_MANAGEMENT_UNAVAILABLE", SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE),
    },
  });
}
