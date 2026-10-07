import { serveCommitmentAction } from "@/app/commit/commitment-route";
import { handleVerifyAttendance } from "@/app/commit/verify-attendance-handler";

export const runtime = "nodejs";

/** UC2-06: the booker marks attendance after the session ends. */
export function POST(request: Request): Promise<Response> {
  return serveCommitmentAction(request, handleVerifyAttendance);
}
