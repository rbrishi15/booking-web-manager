import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { getSessionCancellationDependencies } from "@/app/sessions/cancellation-server-dependencies";
import { readCancellationRequest } from "@/app/sessions/cancellation-input";
import { sessionCancellationErrorResponse } from "@/app/sessions/cancellation-response";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionCancellationDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { sessionId } = await context.params;
    const input = await readCancellationRequest(request, sessionId);
    const result = await dependencies.createCancellation({ idempotencyKey: input.idempotencyKey })
      .forBooker(bookerId, input.sessionId, input.previewVersion);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return sessionCancellationErrorResponse(error); }
}
