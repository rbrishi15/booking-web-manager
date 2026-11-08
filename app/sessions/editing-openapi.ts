import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { sessionEditRequestSchema, sessionEditingDetailsSchema } from "./editing-contract";

export function registerSessionEditingApi(registry: OpenAPIRegistry): void {
  const params = z.object({ sessionId: z.string().uuid() });
  const responses = {
    200: { description: "Current owner-only editing details, including a version for safe saving.", content: { "application/json": { schema: sessionEditingDetailsSchema } } },
    400: errorResponse("Invalid request.", "INVALID_REQUEST", "Invalid session editing request"),
    401: errorResponse("Authentication required.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("Active owner required.", "UNAUTHORIZED", "Only the booker can edit this session"),
    404: errorResponse("Session not found.", "NOT_FOUND", "Session not found"),
    500: errorResponse("Unexpected failure.", "INTERNAL_ERROR", "Internal server error"),
  };
  registry.registerPath({ method: "get", path: "/api/sessions/{sessionId}/edit", operationId: "getSessionEditingDetails",
    tags: ["Sessions"], summary: "Load session editing details", security: [{ bearerAuth: [] }, { loginCookie: [] }], request: { params }, responses });
  registry.registerPath({ method: "patch", path: "/api/sessions/{sessionId}/edit", operationId: "editSession",
    tags: ["Sessions"], summary: "Edit an upcoming session",
    description: "Active owner only. OPEN and strictly before start. Booking terms lock after participation history exists. Capacity includes the booker and reserved/forfeited places. Visibility changes require available capacity. The loaded version must match current state. No wallet or participation changes.",
    security: [{ bearerAuth: [] }, { loginCookie: [] }],
    request: { params, body: { required: true, content: { "application/json": { schema: sessionEditRequestSchema } } } },
    responses: { ...responses, 409: errorResponse("Stale version, locked terms, unavailable capacity or closed/started session.", "STALE_SESSION", "This session has changed. Reload the latest details before saving.") },
  });
}
