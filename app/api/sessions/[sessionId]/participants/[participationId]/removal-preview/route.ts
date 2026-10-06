import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { getSessionRemovalDependencies } from "@/app/sessions/removal-server-dependencies";
import { parseRemovalParams } from "@/app/sessions/removal-input";
import { participantRemovalErrorResponse } from "@/app/sessions/removal-response";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string; participationId: string }> }): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionRemovalDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { sessionId, participationId } = await context.params;
    const input = parseRemovalParams(sessionId, participationId);
    const result = await dependencies.previewRemoval.forBooker(bookerId, input.sessionId, input.participationId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return participantRemovalErrorResponse(error); }
}
