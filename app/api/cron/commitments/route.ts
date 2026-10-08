import { isAuthorizedCronRequest } from "@/app/commit/cron-auth";
import { errorResponse, internalErrorResponse } from "@/app/commit/http";
import { getScheduledJobsDependencies } from "@/app/commit/scheduled-jobs-server-dependencies";
import { loadDependencies } from "@/app/http/load-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * UC2-05/06 scheduled sweep: forfeiture expiry at start, waitlist promotion
 * and 72h auto-verification. GET so Vercel Cron can call it with
 * `Authorization: Bearer <CRON_SECRET>`. Each accepted call is a new run with
 * its own ID; per-job failures are reported in the 200 body and retried next
 * run, while setup or sweep failures stay an opaque 500.
 */
export async function GET(request: Request): Promise<Response> {
  let dependencies;
  try {
    dependencies = await loadDependencies(getScheduledJobsDependencies);
  } catch {
    return internalErrorResponse();
  }
  if (!isAuthorizedCronRequest(request, dependencies.cronSecret)) {
    return errorResponse(401, "UNAUTHENTICATED", "Authentication is required");
  }
  try {
    const report = await dependencies.runner.run(dependencies.ids.next());
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return internalErrorResponse();
  }
}
