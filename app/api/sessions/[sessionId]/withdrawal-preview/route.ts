import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { parseWithdrawalPreviewSessionId } from "@/app/commit/withdrawal-preview-input";
import { withdrawalPreviewErrorResponse } from "@/app/commit/withdrawal-preview-response";
import { getWithdrawalPreviewDependencies } from "@/app/commit/withdrawal-preview-server-dependencies";

export const runtime = "nodejs";

/** UC2-05: what withdrawing now would refund, without saving or moving funds. */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getWithdrawalPreviewDependencies);
    const userId = await requireUserId(request, dependencies.authenticate);
    const { sessionId } = await context.params;
    const result = await dependencies.previewWithdrawal.forParticipant(
      userId,
      parseWithdrawalPreviewSessionId(sessionId),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return withdrawalPreviewErrorResponse(error);
  }
}
