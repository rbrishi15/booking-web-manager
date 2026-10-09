import type { IdGenerator } from "@/use-cases/shared/contracts";
import type { RunScheduledSessionJobs } from "@/use-cases/sessions/RunScheduledSessionJobs";

/** App-owned capabilities for the scheduled commitment sweep route. */
export interface ScheduledJobsDependencies {
  /** Shared secret the scheduler sends as `Authorization: Bearer <secret>`. */
  readonly cronSecret: string;
  readonly runner: Pick<RunScheduledSessionJobs, "run">;
  readonly ids: IdGenerator;
}
