import type { UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import type { AutoVerifyAttendance } from "./AutoVerifyAttendance";
import type { ExpireReplacements } from "./ExpireReplacements";
import type { PromoteFromWaitlist } from "./PromoteFromWaitlist";
import type { DueSessionQuery } from "./scheduling-ports";

export type ScheduledJob = "EXPIRE_REPLACEMENTS" | "PROMOTE" | "AUTO_VERIFY";

export interface ScheduledJobFailure {
  readonly sessionId: UUID;
  readonly job: ScheduledJob;
}

export interface ScheduledJobsReport {
  readonly runId: string;
  readonly sessionsChecked: number;
  readonly forfeitureDue: readonly UUID[];
  readonly promoted: readonly UUID[];
  readonly autoVerified: readonly UUID[];
  /** Jobs that threw; their sessions are retried on the next run. */
  readonly failures: readonly ScheduledJobFailure[];
}

export interface RunScheduledSessionJobsDependencies {
  readonly dueSessions: DueSessionQuery;
  readonly expireReplacements: Pick<ExpireReplacements, "forSession">;
  readonly promote: Pick<PromoteFromWaitlist, "forSession">;
  readonly autoVerify: Pick<AutoVerifyAttendance, "forSession">;
  readonly clock: Clock;
  /** Maximum sessions per run, so one run stays within the cron timeout. */
  readonly batchSize: number;
}

/**
 * The periodic sweep behind UC2-05 and UC2-06's time-triggered transitions.
 *
 * For each session that may have work due it runs, in order:
 * 1. ExpireReplacements: at start, unreplaced late withdrawals become
 *    FORFEITURE_DUE.
 * 2. PromoteFromWaitlist: fills free places, recovering promotions that a
 *    withdrawal reported as DEFERRED.
 * 3. AutoVerifyAttendance: 72 hours after the session ends.
 *
 * Each job is its own unit of work keyed by `runId`, so a retried run replays
 * rather than repeats. A failing job is recorded and the sweep continues; the
 * next run picks the session up again.
 */
export class RunScheduledSessionJobs {
  constructor(
    private readonly dependencies: RunScheduledSessionJobsDependencies,
  ) {}

  async run(runId: string): Promise<ScheduledJobsReport> {
    const { dueSessions, expireReplacements, promote, autoVerify, clock } =
      this.dependencies;
    const sessionIds = await dueSessions.dueSessionIds(
      clock.now(),
      this.dependencies.batchSize,
    );
    const forfeitureDue: UUID[] = [];
    const promoted: UUID[] = [];
    const autoVerified: UUID[] = [];
    const failures: ScheduledJobFailure[] = [];
    const attempt = async (
      sessionId: UUID,
      job: ScheduledJob,
      work: () => Promise<void>,
    ) => {
      try {
        await work();
      } catch {
        failures.push({ sessionId, job });
      }
    };

    for (const sessionId of sessionIds) {
      const request = { sessionId, triggerKey: runId };
      await attempt(sessionId, "EXPIRE_REPLACEMENTS", async () => {
        const result = await expireReplacements.forSession(request);
        forfeitureDue.push(...result.forfeitureDue);
      });
      await attempt(sessionId, "PROMOTE", async () => {
        const result = await promote.forSession(request);
        promoted.push(...result.promoted.map((entry) => entry.participationId));
      });
      await attempt(sessionId, "AUTO_VERIFY", async () => {
        const result = await autoVerify.forSession(request);
        if (result.outcome === "VERIFIED")
          autoVerified.push(...result.verifiedParticipationIds);
      });
    }

    return {
      runId,
      sessionsChecked: sessionIds.length,
      forfeitureDue,
      promoted,
      autoVerified,
      failures,
    };
  }
}
