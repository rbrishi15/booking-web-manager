import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { cancellationParamsSchema, cancellationRequestSchema } from "./cancellation-input";
import { SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE } from "./session-management-unavailable";

export function registerSessionCancellationApi(registry: OpenAPIRegistry): void {
  const summary = { refundRecipientCount: z.number().int().nonnegative(), totalRefundCents: z.number().int().nonnegative() };
  const preview = registry.register("SessionCancellationPreview", z.object({
    sessionId: z.string().uuid(), affectedParticipantCount: z.number().int().nonnegative(),
    ...summary, previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
  }));
  const result = registry.register("SessionCancellationResult", z.object({ sessionId: z.string().uuid(), status: z.literal("CANCELLED"), ...summary }));
  const errors = {
    400: errorResponse("Malformed ID, JSON, request key or preview version.", "INVALID_REQUEST", "Invalid session cancellation request"),
    401: errorResponse("Bearer authentication required.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("Inactive account or foreign owner.", "UNAUTHORIZED", "Only the booker may perform this action"),
    404: errorResponse("Missing user or session.", "NOT_FOUND", "Session was not found"),
    409: errorResponse("Started/closed session, changed preview or conflicting request key.", "STALE_CANCELLATION_PREVIEW", "Review the updated refunds before confirming."),
    500: errorResponse("Opaque infrastructure failure.", "INTERNAL_ERROR", "Internal server error"),
    503: errorResponse("Server settings unavailable.", "SESSION_MANAGEMENT_UNAVAILABLE", SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE),
  };
  registry.registerPath({
    method: "get", path: "/api/sessions/{sessionId}/cancellation-preview", operationId: "previewSessionCancellation",
    tags: ["Sessions"], summary: "UC2-03c Preview cancellation refunds",
    description: "Active owner of an OPEN, upcoming session. Includes full sessions. Calculates outstanding refunds in integer cents without saving or moving funds; counts affected participants separately from refund recipients.",
    security: [{ bearerAuth: [] }], request: { params: cancellationParamsSchema },
    responses: { 200: { description: "Server-calculated confirmation preview; no financial effects.", content: { "application/json": { schema: preview } } }, ...errors },
  });
  registry.registerPath({
    method: "post", path: "/api/sessions/{sessionId}/cancel", operationId: "cancelSession",
    tags: ["Sessions"], summary: "UC2-03c Cancel a session and refund outstanding holds",
    description: "Requires active owner, an OPEN upcoming session and matching previewVersion. Send a UUID idempotencyKey; reuse the identical payload/key after an ambiguous failure. Returns only after cancellation, wallet refunds and response replay data commit atomically. Same-key retries recheck active access and return the original result without new refunds; different requests against closed sessions conflict. Preserves removed/cancelled history. Refunds use historical hold amounts, with no cancellation fee. Venue booking cancellation remains external. Requires migration 0007 before deployment.",
    security: [{ bearerAuth: [] }], request: { params: cancellationParamsSchema,
      body: { required: true, content: { "application/json": { schema: registry.register("SessionCancellationRequest", cancellationRequestSchema) } } } },
    responses: { 200: { description: "Committed cancellation or authorized replay.", content: { "application/json": { schema: result } } }, ...errors },
  });
}
