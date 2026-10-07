import { serveCommitmentAction } from "@/app/commit/commitment-route";
import { handleCommitToSession } from "@/app/commit/commit-to-session-handler";

export const runtime = "nodejs";

/** UC2-04: commit to a session, locking the share in the same transaction, or join its waitlist. */
export function POST(request: Request): Promise<Response> {
  return serveCommitmentAction(request, handleCommitToSession);
}
