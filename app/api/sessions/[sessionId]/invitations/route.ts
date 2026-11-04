import { createAuthenticatedActions } from "@/app/http/authenticated-action";
import { getSessionInvitationManagementDependencies } from "@/app/sessions/session-invitation-server-dependencies";
import { sendSessionInvitationsSchema, sessionInvitationsParamsSchema } from "@/app/sessions/session-invitation-contract";
import { sessionVisibilityErrorResponse } from "@/app/sessions/visibility-response";

export const runtime = "nodejs";

const actions = createAuthenticatedActions({
  getDependencies: getSessionInvitationManagementDependencies,
  errorResponse: sessionVisibilityErrorResponse,
});

export const GET = actions.get({
  parse: (hostId, params) => ({ hostId, ...sessionInvitationsParamsSchema.parse(params) }),
  run: (dependencies, input) => dependencies.invitations.optionsForBooker(input.hostId, input.sessionId),
  serialize: (options) => ({ groups: options.groups,
    invitations: options.invitations.map((invitation) => ({ ...invitation, invitedAt: invitation.invitedAt.toISOString() })) }),
  invalidRequestMessage: "Invalid session invitation request",
});

export const POST = actions.json({
  parse: (hostId, body, params) => ({ hostId, ...sessionInvitationsParamsSchema.parse(params), selection: sendSessionInvitationsSchema.parse(body) }),
  run: (dependencies, { hostId, sessionId, selection }) => selection.source === "direct"
    ? dependencies.invitations.inviteByHandles(hostId, sessionId, selection.handles)
    : dependencies.invitations.inviteFromGroup(hostId, sessionId, selection.groupId, selection.userIds),
  invalidRequestMessage: "Select 1 to 50 valid players or group members",
});
