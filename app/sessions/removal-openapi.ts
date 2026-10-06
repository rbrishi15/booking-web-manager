import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { removalParamsSchema, removalRequestSchema, removalSessionParamsSchema } from "./removal-input";
import { SESSION_REMOVAL_UNAVAILABLE_MESSAGE } from "./removal-unavailable";

export function registerParticipantRemovalApi(registry: OpenAPIRegistry): void {
  const identities = { sessionId: z.string().uuid(), participationId: z.string().uuid() };
  const preview = registry.register("ParticipantRemovalPreview", z.object({
    ...identities, refundCents: z.number().int().nonnegative(), previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
  }));
  const result = registry.register("ParticipantRemovalResult", z.object({
    ...identities, status: z.literal("REMOVED"), refundCents: z.number().int().nonnegative(),
  }));
  const participants = registry.register("SessionParticipants", z.object({
    sessionId: z.string().uuid(), venueName: z.string(), sport: z.string(),
    startAt: z.string().datetime(), endAt: z.string().datetime(),
    status: z.enum(["OPEN", "CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"]),
    availableSlots: z.number().int().nonnegative(),
    participants: z.array(z.object({
      participationId: z.string().uuid(), displayName: z.string(),
      status: z.enum(["WAITLISTED", "COMMITTED", "LEFT_WAITLIST", "WITHDRAWN", "REMOVED", "CANCELLED"]),
      canRemove: z.boolean(),
    })),
  }));
  const errors = {
    400: errorResponse("Malformed IDs, JSON, request key or preview version.", "INVALID_REQUEST", "Invalid participant removal request"),
    401: errorResponse("Bearer authentication required.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("Inactive account or foreign owner.", "UNAUTHORIZED", "Only the booker may perform this action"),
    404: errorResponse("Missing user, session or participant.", "NOT_FOUND", "Participation was not found"),
    409: errorResponse("Started/closed session, ineligible target, changed preview or conflicting request key.", "STALE_REMOVAL_PREVIEW", "Review the updated refund before confirming."),
    500: errorResponse("Opaque infrastructure failure.", "INTERNAL_ERROR", "Internal server error"),
    503: errorResponse("Server settings unavailable.", "SESSION_REMOVAL_UNAVAILABLE", SESSION_REMOVAL_UNAVAILABLE_MESSAGE),
  };
  registry.registerPath({
    method: "get", path: "/api/sessions/{sessionId}/participants", operationId: "listSessionParticipants",
    tags: ["Sessions"], summary: "UC2-03b List session participants",
    description: "Active session owner only. Returns names and statuses in preserved participant-list order, including departure history. canRemove is true only for committed participants in an OPEN upcoming session. Times are ISO dates; no wallet or private profile details are returned.",
    security: [{ bearerAuth: [] }], request: { params: removalSessionParamsSchema },
    responses: { 200: { description: "Owned session and participants.", content: { "application/json": { schema: participants } } }, ...errors },
  });
  registry.registerPath({
    method: "get", path: "/api/sessions/{sessionId}/participants/{participationId}/removal-preview", operationId: "previewParticipantRemoval",
    tags: ["Sessions"], summary: "UC2-03b Preview participant removal refund",
    description: "Active owner of an OPEN upcoming session. Calculates the target participant's full historical held amount in integer SGD cents, including within 30 hours of session start. Read-only; the preview binds ownership, session lifecycle and target participation/hold. Unrelated participant and visibility changes do not invalidate it.",
    security: [{ bearerAuth: [] }], request: { params: removalParamsSchema },
    responses: { 200: { description: "Server-calculated refund with no financial effects.", content: { "application/json": { schema: preview } } }, ...errors },
  });
  registry.registerPath({
    method: "post", path: "/api/sessions/{sessionId}/participants/{participationId}/remove", operationId: "removeParticipant",
    tags: ["Sessions"], summary: "UC2-03b Remove a participant and refund their hold",
    description: "Requires an active owner, committed target, OPEN upcoming session and matching previewVersion. Send a UUID idempotencyKey and reuse the identical target, payload and key after an ambiguous failure. Removal state, full wallet refund and response replay data commit atomically. Same-key retries recheck active access and return the original result without refunding again; changed target or preview conflicts. Removed users cannot rejoin this session. Frees capacity but does not automatically promote the waitlist; queue order and replacement history are preserved. Requires existing migrations through 0007; no new migration.",
    security: [{ bearerAuth: [] }], request: { params: removalParamsSchema,
      body: { required: true, content: { "application/json": {
        schema: registry.register("ParticipantRemovalRequest", removalRequestSchema),
        example: { idempotencyKey: "30000000-0000-4000-8000-000000000001", previewVersion: "a".repeat(64) },
      } } } },
    responses: { 200: { description: "Committed removal or authorized replay.", content: { "application/json": { schema: result } } }, ...errors },
  });
}
