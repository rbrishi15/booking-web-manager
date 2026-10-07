import { serveCommitmentAction } from "@/app/commit/commitment-route";
import { handleWithdrawFromSession } from "@/app/commit/withdrawal-handlers";

export const runtime = "nodejs";

/** UC2-05: withdraw; the domain applies the 30-hour refund rule. */
export function POST(request: Request): Promise<Response> {
  return serveCommitmentAction(request, handleWithdrawFromSession);
}
