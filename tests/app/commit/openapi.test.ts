import { describe, expect, test, vi } from "vitest";

const getDependencies = vi.hoisted(() => vi.fn());
vi.mock("@/app/commit/commitment-server-dependencies", () => ({
  getCommitmentDependencies: getDependencies,
}));
import { openApiDocument } from "@/app/openapi";
import { POST as commit } from "@/app/api/sessions/commit/route";
import { POST as withdrawRoute } from "@/app/api/sessions/withdraw/route";
import { POST as acceptRoute } from "@/app/api/sessions/replacements/accept/route";
import { POST as leaveRoute } from "@/app/api/sessions/waitlist/leave/route";
import { POST as verifyRoute } from "@/app/api/sessions/attendance/route";
import { handleScheduledJobs } from "@/app/commit/scheduled-jobs-handler";
import { commitmentDependencies } from "./commitment-test-dependencies";

const userId = "44444444-4444-4444-8444-444444444444";
const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";
const paths = [
  "/api/sessions/commit",
  "/api/sessions/withdraw",
  "/api/sessions/replacements/accept",
  "/api/sessions/waitlist/leave",
  "/api/sessions/attendance",
] as const;

function exampleAt(path: string): object {
  const body = openApiDocument.paths[path]?.post?.requestBody;
  if (!body || !("content" in body)) throw new Error("Missing documented request");
  const example: unknown = body.content["application/json"]?.example;
  if (example === null || typeof example !== "object") throw new Error("Missing request example");
  return example;
}

function requestFor(path: string): Request {
  return new Request("http://localhost" + path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(exampleAt(path)),
  });
}

describe("commitment Swagger contracts", () => {
  test.each(paths)("%s describes a mounted route with user authentication", (path) => {
    const operation = openApiDocument.paths[path]?.post;
    expect(operation?.description).not.toContain("no Next.js route is mounted here yet");
    expect(operation?.description).toContain("Supabase bearer token");
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      path.endsWith("/commit") || path.endsWith("/accept") ? "201" : "200",
      "400", "401", "403", "404", "409", "422", "500", "503",
    ]);
  });

  test("the commit example is accepted by the mounted route and supplies no actor or price", async () => {
    const path = paths[0];
    const forParticipant = vi.fn(async () => ({
      kind: "COMMITTED" as const, sessionId, participationId, heldCents: 500,
    }));
    getDependencies.mockResolvedValue(commitmentDependencies({
      authenticate: async () => userId, commitToSession: { forParticipant },
    }));
    const response = await commit(requestFor(path));
    expect(response.status).toBe(201);
    expect(forParticipant).toHaveBeenCalledWith({
      ...exampleAt(path), userId,
    });
    expect(exampleAt(path)).not.toHaveProperty("userId");
    expect(exampleAt(path)).not.toHaveProperty("heldCents");
  });

  test("withdrawal and invitation examples are accepted by the mounted routes", async () => {
    const withdraw = vi.fn(async () => ({
      kind: "REFUNDED" as const, sessionId, participationId, refundedCents: 500,
      promotion: { status: "NOT_NEEDED" as const },
    }));
    const accept = vi.fn(async () => ({ sessionId, participationId, heldCents: 500 }));
    const leave = vi.fn(async () => ({
      sessionId, participationId, promotion: { status: "DEFERRED" as const },
    }));
    getDependencies.mockResolvedValue(commitmentDependencies({
      authenticate: async () => userId,
      withdrawFromSession: { forParticipant: withdraw },
      acceptReplacement: { forInvitee: accept },
      leaveWaitlist: { forParticipant: leave },
    }));
    expect((await withdrawRoute(requestFor(paths[1]))).status).toBe(200);
    expect(withdraw).toHaveBeenCalledWith({ ...exampleAt(paths[1]), userId });
    expect((await acceptRoute(requestFor(paths[2]))).status).toBe(201);
    expect(accept).toHaveBeenCalledWith({ ...exampleAt(paths[2]), userId });
    expect((await leaveRoute(requestFor(paths[3]))).status).toBe(200);
    expect(leave).toHaveBeenCalledWith({ ...exampleAt(paths[3]), userId });
  });

  test("attendance example invokes the mounted booker-verification route", async () => {
    const forBooker = vi.fn(async () => ({ sessionId, status: "AWAITING_PAYOUT" as const }));
    getDependencies.mockResolvedValue(commitmentDependencies({
      authenticate: async () => userId, verifyAttendance: { forBooker },
    }));
    const response = await verifyRoute(requestFor(paths[4]));
    expect(response.status).toBe(200);
    expect(forBooker).toHaveBeenCalledWith({ ...exampleAt(paths[4]), userId });
  });

  test("documents integer cents, fixed replacement choices, attendance marks and nonblank keys", () => {
    const schemas = openApiDocument.components?.schemas;
    expect(schemas?.CommitToSessionResult).toMatchObject({
      properties: { heldCents: { type: "integer", minimum: 0 } },
    });
    expect(schemas?.WithdrawFromSessionResult).toMatchObject({
      properties: { refundedCents: { type: "integer", minimum: 0 } },
    });
    expect(schemas?.CommitToSessionRequest).toMatchObject({
      required: ["sessionId", "idempotencyKey"],
      properties: { idempotencyKey: { type: "string", pattern: "\\S" } },
    });
    expect(schemas?.WithdrawFromSessionRequest).toMatchObject({
      required: ["sessionId", "idempotencyKey", "replacement"],
    });
    expect(schemas?.VerifyAttendanceRequest).toMatchObject({
      properties: { marks: { type: "array", minItems: 1,
        items: { properties: { attendance: { enum: ["ATTENDED", "ABSENT"] } } } } },
    });
  });

  test("the cron contract separates its secret from user JWTs and allows partial job failures", async () => {
    const operation = openApiDocument.paths["/api/cron/commitments"]?.get;
    expect(operation?.security).toEqual([{ cronAuth: [] }]);
    expect(operation?.requestBody).toBeUndefined();
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "401", "500"]);
    expect(operation?.description).toContain("GET is proposed");
    expect(openApiDocument.components?.securitySchemes?.cronAuth).toMatchObject({
      type: "http", scheme: "bearer",
    });
    const report = {
      runId: "server-run", sessionsChecked: 1, forfeitureDue: [], promoted: [],
      autoVerified: [], verificationReminders: [],
      failures: [{ sessionId, job: "PROMOTE" as const }],
    };
    const run = vi.fn(async () => report);
    const response = await handleScheduledJobs(new Request("http://localhost/api/cron/commitments", {
      headers: { authorization: "Bearer test-cron-secret" },
    }), { cronSecret: "test-cron-secret", ids: { next: () => "server-run" }, runner: { run } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
    expect(run).toHaveBeenCalledWith("server-run");
  });
});
