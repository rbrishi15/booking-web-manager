import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { getSessionRemovalDependencies } from "@/app/sessions/removal-server-dependencies";
import { parseRemovalSessionId } from "@/app/sessions/removal-input";
import { participantRemovalErrorResponse } from "@/app/sessions/removal-response";
import { serializeSessionParticipants } from "@/app/sessions/removal-types";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionRemovalDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { sessionId } = await context.params;
    const result = await dependencies.listParticipants.forBooker(bookerId, parseRemovalSessionId(sessionId));
    return Response.json(serializeSessionParticipants(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return participantRemovalErrorResponse(error); }
}
