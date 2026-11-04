import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse } from "@/app/openapi/contracts";
import { sendSessionInvitationsSchema, sessionInvitationOptionsSchema, sessionInvitationsParamsSchema, sessionInviteSummarySchema } from "./session-invitation-contract";
import { SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE } from "./session-management-unavailable";

export function registerSessionInvitationManagementApi(registry: OpenAPIRegistry): void {
  const options = registry.register("SessionInvitationOptions", sessionInvitationOptionsSchema);
  const summary = registry.register("SessionInviteSummary", sessionInviteSummarySchema);
  const selection = registry.register("SendSessionInvitationsRequest", sendSessionInvitationsSchema);
  const common = {
    path: "/api/sessions/{sessionId}/invitations",
    tags: ["Sessions"],
  };
  const errors = {
    400: errorResponse("Invalid UUID, JSON, source, handle, empty/oversized batch or duplicate recipients.", "INVALID_REQUEST", "Select 1 to 50 valid players or group members"),
    401: errorResponse("Missing or invalid authentication.", "UNAUTHENTICATED", "Authentication is required"),
    403: errorResponse("Inactive or foreign owner, inactive group, or stale group membership/selection.", "UNAUTHORIZED", "Only the booker can manage this session"),
    404: errorResponse("Missing session, host or active recipient.", "NOT_FOUND", "One or more players could not be found"),
    409: errorResponse("Session is closed or has started (send only).", "SESSION_CLOSED", "This session is closed for invitations"),
    500: errorResponse("Unexpected failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
    503: errorResponse("Required server configuration is unavailable.", "SESSION_MANAGEMENT_UNAVAILABLE", SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE),
  };
  registry.registerPath({ ...common, security: [{ bearerAuth: [] }, { loginCookie: [] }], method: "get", operationId: "getSessionInvitationOptions",
    summary: "Get invitation history and groups for a hosted session",
    description: "Active session booker only. Returns invitation history and active groups with eligible members for selection. Closed/past sessions remain readable by their owner. Groups are revalidated at send time. Bearer tokens or same-origin login cookies are accepted. All responses use Cache-Control: no-store.",
    request: { params: sessionInvitationsParamsSchema },
    responses: { 200: { description: "Owner-only invitation history and group options.", content: { "application/json": { schema: options } } }, ...errors },
  });
  registry.registerPath({ ...common, security: [{ bearerAuth: [] }], method: "post", operationId: "sendSessionInvitations",
    summary: "Invite players by exact user IDs or selected group members",
    description: "Active booker of an OPEN upcoming session only. Send source=direct with 1–50 exact handles (case insensitive, optional @), or source=group with an active group UUID and 1–50 member UUIDs. Duplicate selections are rejected after normalization. Group membership and recipient eligibility are rechecked transactionally. Existing invitations and participants are counted and skipped. Invitations and canonical notifications commit atomically, without reserving places, enrolling players or charging wallets. Retrying an identical selection cannot duplicate invitations or notifications. Recipients confirm through the existing join flow. Requires a bearer token for sends; login cookies alone cannot authorize writes. All responses use Cache-Control: no-store. Requires migration 0023_session_invitations.",
    request: { params: sessionInvitationsParamsSchema,
      body: { required: true, content: { "application/json": { schema: selection } } } },
    responses: { 200: { description: "Number newly invited, already invited and already participating.", content: { "application/json": { schema: summary } } }, ...errors },
  });
}
