import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { getSessionManagementDependencies } from "@/app/sessions/management-server-dependencies";
import { readSessionVisibilityRequest } from "@/app/sessions/visibility-input";
import { sessionVisibilityErrorResponse } from "@/app/sessions/visibility-response";

export const runtime = "nodejs";

/** Sets session visibility for the bearer-authenticated owner and returns the committed result or a safe HTTP error. */
export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionManagementDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { sessionId } = await context.params;
    const input = await readSessionVisibilityRequest(request, sessionId);
    const result = await dependencies.toggleVisibility.forBooker(bookerId, input.sessionId, input.visibility);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return sessionVisibilityErrorResponse(error);
  }
}
