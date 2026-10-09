import { DomainError } from "@/domain";
import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { toHostedSessionsResponse } from "@/app/sessions/hosted-sessions-response";
import { getSessionManagementDependencies } from "@/app/sessions/management-server-dependencies";
import { sessionVisibilityErrorResponse } from "@/app/sessions/visibility-response";

export const runtime = "nodejs";

/** UC2-03 / UC2-06: the authenticated booker's hosted sessions and those awaiting their attendance check. */
export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionManagementDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const [sessions, attendanceDue] = await Promise.all([
      dependencies.listHostedSessions.forBooker(bookerId),
      // The attendance reminder is secondary: if it fails, still return the hosted sessions.
      // Account problems are still reported.
      dependencies.listHostedSessions.attendanceDueForBooker(bookerId).catch((error: unknown) => {
        if (error instanceof DomainError && (error.code === "INACTIVE_ACCOUNT" || error.code === "NOT_FOUND")) throw error;
        console.error("UC2-06 attendance-due list failed:", error instanceof Error ? error.name : "unknown");
        return [];
      }),
    ]);
    return Response.json(toHostedSessionsResponse(sessions, attendanceDue), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return sessionVisibilityErrorResponse(error);
  }
}
