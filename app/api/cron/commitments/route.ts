import { internalErrorResponse } from "@/app/commit/http";
import { handleScheduledJobs } from "@/app/commit/scheduled-jobs-handler";
import { getScheduledJobsDependencies } from "@/app/commit/scheduled-jobs-server-dependencies";
import { loadDependencies } from "@/app/http/load-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * UC2-05/06 scheduled sweep. GET so Vercel Cron can call it; it sends
 * `Authorization: Bearer <CRON_SECRET>`, which the handler requires.
 */
export async function GET(request: Request): Promise<Response> {
  let dependencies;
  try {
    dependencies = await loadDependencies(getScheduledJobsDependencies);
  } catch {
    return internalErrorResponse();
  }
  return handleScheduledJobs(request, dependencies);
}
