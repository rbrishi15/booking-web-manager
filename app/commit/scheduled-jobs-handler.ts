import { timingSafeEqual } from "node:crypto";
import type { IdGenerator } from "@/use-cases/shared/contracts";
import type { RunScheduledSessionJobs } from "@/use-cases/sessions/RunScheduledSessionJobs";

export interface ScheduledJobsHttpDependencies {
  /** Shared secret the scheduler sends as `Authorization: Bearer <secret>`. */
  readonly cronSecret: string;
  readonly runner: Pick<RunScheduledSessionJobs, "run">;
  readonly ids: IdGenerator;
}

/**
 * Entry point for the periodic commitment sweep (forfeiture expiry at start,
 * waitlist promotion, 72h auto-verification). Called by the scheduler, never
 * by users: it accepts only the configured bearer secret, compared in
 * constant time. Each call is a new run with its own ID.
 */
export async function handleScheduledJobs(
  request: Request,
  dependencies: ScheduledJobsHttpDependencies,
): Promise<Response> {
  if (!isAuthorized(request, dependencies.cronSecret)) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Authentication is required" } },
      { status: 401 },
    );
  }

  try {
    const report = await dependencies.runner.run(dependencies.ids.next());
    return Response.json(report, { status: 200 });
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 },
    );
  }
}

function isAuthorized(request: Request, cronSecret: string): boolean {
  // An unset secret must never authorize a request.
  if (cronSecret.trim() === "") return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(header);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
