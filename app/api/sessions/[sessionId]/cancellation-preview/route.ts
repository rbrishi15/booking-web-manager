import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { getSessionCancellationDependencies } from "@/app/sessions/cancellation-server-dependencies";
import { parseCancellationSessionId } from "@/app/sessions/cancellation-input";
import { sessionCancellationErrorResponse } from "@/app/sessions/cancellation-response";
import { withCancellationAction } from "@/app/sessions/session-actions";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionCancellationDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { sessionId } = await context.params;
    const result = await dependencies.previewCancellation.forBooker(bookerId, parseCancellationSessionId(sessionId));
    return Response.json(withCancellationAction(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return sessionCancellationErrorResponse(error); }
}
