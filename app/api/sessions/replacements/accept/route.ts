import { serveCommitmentAction } from "@/app/commit/commitment-route";
import { handleAcceptReplacement } from "@/app/commit/withdrawal-handlers";

export const runtime = "nodejs";

/** UC2-05: accept a named replacement invitation, refunding the withdrawer. */
export function POST(request: Request): Promise<Response> {
  return serveCommitmentAction(request, handleAcceptReplacement);
}
