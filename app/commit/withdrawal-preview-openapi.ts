import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse, z } from "@/app/openapi/contracts";
import { SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE } from "@/app/sessions/session-management-unavailable";
import { withdrawalPreviewParamsSchema } from "./withdrawal-preview-input";

export function registerWithdrawalPreviewApi(registry: OpenAPIRegistry): void {
  const preview = registry.register(
    "WithdrawalPreview",
    z.object({
      sessionId: z.string().uuid(),
      participationId: z.string().uuid(),
      kind: z.enum(["REFUNDED", "AWAITING_REPLACEMENT"]),
      refundCents: z.number().int().nonnegative().safe(),
      heldCents: z.number().int().nonnegative().safe(),
    }),
  );
  registry.registerPath({
    method: "get",
    path: "/api/sessions/{sessionId}/withdrawal-preview",
    operationId: "previewWithdrawal",
    tags: ["Sessions"],
    summary: "UC2-05 Preview withdrawal refund",
    description: [
      "Shows what the authenticated participant's withdrawal would do right now, before they confirm it.",
      "More than 30 hours before start: kind REFUNDED, and refundCents equals the held share.",
      "At 30 hours or less: kind AWAITING_REPLACEMENT and refundCents 0; the share stays held until a replacement joins, and is forfeited to the booker if none does before start.",
      "Uses the same rule as the withdrawal, so the preview matches a withdrawal made at the same moment. Integer cents. Nothing is saved and no money moves.",
      "Requires migrations through 0007_session_management.",
    ].join(" "),
    security: [{ bearerAuth: [] }],
    request: { params: withdrawalPreviewParamsSchema },
    responses: {
      200: {
        description: "Server-calculated preview; no financial effects.",
        content: { "application/json": { schema: preview } },
      },
      400: errorResponse("Malformed session ID.", "INVALID_REQUEST", "Invalid session ID"),
      401: errorResponse("Bearer authentication required.", "UNAUTHENTICATED", "Authentication is required"),
      404: errorResponse(
        "Missing user or session, or the user is not participating.",
        "NOT_FOUND",
        "This user is not participating in the session",
      ),
      409: errorResponse(
        "Already withdrawn or not committed, or the session has started or closed.",
        "INVALID_STATE",
        "Only a committed participant can withdraw",
      ),
      500: errorResponse("Opaque infrastructure failure.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse(
        "Server settings unavailable.",
        "SESSION_MANAGEMENT_UNAVAILABLE",
        SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE,
      ),
    },
  });
}
