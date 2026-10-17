import { toHostedSessionsResponse } from "@/app/sessions/hosted-sessions-response";
import { sessionManagementGetAction } from "@/app/sessions/management-action";

export const runtime = "nodejs";

/** UC2-03 / UC2-06: the authenticated booker's hosted sessions and those awaiting their attendance check. */
export const GET = sessionManagementGetAction({
  parse: (bookerId) => bookerId,
  run: (dependencies, bookerId) => dependencies.listHostedSessions.forBooker(bookerId),
  serialize: toHostedSessionsResponse,
});
