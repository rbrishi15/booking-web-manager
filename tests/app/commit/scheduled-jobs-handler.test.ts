import { handleScheduledJobs } from "@/app/commit/scheduled-jobs-handler";
import type { ScheduledJobsReport } from "@/use-cases/sessions/RunScheduledSessionJobs";
import { describe, expect, test } from "vitest";

const secret = "cron-secret-value";

describe("handleScheduledJobs", () => {
  test("handleScheduledJobs_WhenBearerSecretMatches_RunsOneSweepAndReturnsReport", async () => {
    // Arrange
    const { handle, runIds } = handlerScenario();

    // Act
    const response = await handle(cronRequest(`Bearer ${secret}`));

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runId: "run-1" });
    expect(runIds).toEqual(["run-1"]);
  });

  test("handleScheduledJobs_WhenCalledTwice_UsesANewRunIdEachTime", async () => {
    // Arrange
    const { handle, runIds } = handlerScenario();
    await handle(cronRequest(`Bearer ${secret}`));

    // Act
    await handle(cronRequest(`Bearer ${secret}`));

    // Assert
    expect(runIds).toEqual(["run-1", "run-2"]);
  });

  test("handleScheduledJobs_WhenAuthorizationIsMissing_Returns401WithoutRunning", async () => {
    // Arrange
    const { handle, runIds } = handlerScenario();

    // Act
    const response = await handle(cronRequest(undefined));

    // Assert
    expect(response.status).toBe(401);
    expect(runIds).toEqual([]);
  });

  test("handleScheduledJobs_WhenSecretIsWrong_Returns401WithoutRunning", async () => {
    // Arrange
    const { handle, runIds } = handlerScenario();

    // Act
    const response = await handle(cronRequest("Bearer cron-secret-valuf"));

    // Assert
    expect(response.status).toBe(401);
    expect(runIds).toEqual([]);
  });

  test("handleScheduledJobs_WhenSecretIsUnconfigured_RejectsAnEmptyBearer", async () => {
    // Arrange
    const { handle, runIds } = handlerScenario({ cronSecret: "" });

    // Act
    const response = await handle(cronRequest("Bearer "));

    // Assert
    expect(response.status).toBe(401);
    expect(runIds).toEqual([]);
  });

  test("handleScheduledJobs_WhenRunnerFails_Returns500WithoutDetails", async () => {
    // Arrange
    const { handle } = handlerScenario({ failRun: true });

    // Act
    const response = await handle(cronRequest(`Bearer ${secret}`));

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});

function handlerScenario(
  options: { cronSecret?: string; failRun?: boolean } = {},
) {
  const runIds: string[] = [];
  let nextId = 0;
  const handle = (request: Request) =>
    handleScheduledJobs(request, {
      cronSecret: options.cronSecret ?? secret,
      ids: { next: () => `run-${++nextId}` },
      runner: {
        run: async (runId): Promise<ScheduledJobsReport> => {
          runIds.push(runId);
          if (options.failRun) throw new Error("database unavailable");
          return {
            runId,
            sessionsChecked: 0,
            forfeitureDue: [],
            promoted: [],
            autoVerified: [],
            failures: [],
          };
        },
      },
    });
  return { handle, runIds };
}

function cronRequest(authorization: string | undefined): Request {
  return new Request("http://localhost/api/cron/commitments", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}
