import { serveCommitmentAction } from "@/app/commit/commitment-route";
import { handleLeaveWaitlist } from "@/app/commit/withdrawal-handlers";

export const runtime = "nodejs";

/** UC2-05: leave the joining waitlist. */
export function POST(request: Request): Promise<Response> {
  return serveCommitmentAction(request, handleLeaveWaitlist);
}
