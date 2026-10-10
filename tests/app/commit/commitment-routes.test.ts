import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  authenticate: vi.fn(),
  commit: vi.fn(),
  withdraw: vi.fn(),
  accept: vi.fn(),
  leave: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/app/commit/commitment-server-dependencies", () => ({
  getCommitmentDependencies: mocks.dependencies,
}));
import { POST as commit } from "@/app/api/sessions/commit/route";
import { POST as withdraw } from "@/app/api/sessions/withdraw/route";
import { POST as accept } from "@/app/api/sessions/replacements/accept/route";
import { POST as leave } from "@/app/api/sessions/waitlist/leave/route";
import { POST as verify } from "@/app/api/sessions/attendance/route";
import { createCommitmentDependencies } from "@/use-case-config/commitments";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const participationId = "30000000-0000-4000-8000-000000000001";
const inviteeId = "40000000-0000-4000-8000-000000000001";
const result = { sessionId, participationId };

const routes = [
  {
    name: "commit",
    post: commit,
    useCase: mocks.commit,
    status: 201,
    body: { sessionId, idempotencyKey: "key-1", roomToken: "room" },
    expected: { userId, sessionId, idempotencyKey: "key-1", roomToken: "room" },
  },
  {
    name: "withdraw",
    post: withdraw,
    useCase: mocks.withdraw,
    status: 200,
    body: {
      sessionId,
      idempotencyKey: "key-1",
      replacement: { mode: "DIRECT_INVITE", inviteeId },
    },
    expected: {
      userId,
      sessionId,
      idempotencyKey: "key-1",
      replacement: { mode: "DIRECT_INVITE", inviteeId },
    },
  },
  {
    name: "replacements/accept",
    post: accept,
    useCase: mocks.accept,
    status: 201,
    body: { sessionId, idempotencyKey: "key-1" },
    expected: { userId, sessionId, idempotencyKey: "key-1" },
  },
  {
    name: "waitlist/leave",
    post: leave,
    useCase: mocks.leave,
    status: 200,
    body: { sessionId, idempotencyKey: "key-1" },
    expected: { userId, sessionId, idempotencyKey: "key-1" },
  },
  {
    name: "attendance",
    post: verify,
    useCase: mocks.verify,
    status: 200,
    body: {
      sessionId,
      idempotencyKey: "key-1",
      marks: [{ participationId, attendance: "ATTENDED" }],
    },
    expected: {
      userId,
      sessionId,
      idempotencyKey: "key-1",
      marks: [{ participationId, attendance: "ATTENDED" }],
    },
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(userId);
  for (const route of routes) route.useCase.mockResolvedValue(result);
  mocks.dependencies.mockResolvedValue({
    authenticate: mocks.authenticate,
    commitToSession: { forParticipant: mocks.commit },
    withdrawFromSession: { forParticipant: mocks.withdraw },
    acceptReplacement: { forInvitee: mocks.accept },
    leaveWaitlist: { forParticipant: mocks.leave },
    verifyAttendance: { forBooker: mocks.verify },
  });
});

function request(name: string, body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${name}`, {
    method: "POST",
    headers: { Authorization: "Bearer trusted", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.each(routes)("POST /api/sessions/$name", (route) => {
  test("runs the use case as the authenticated user, uncached", async () => {
    const response = await route.post(
      request(route.name, { ...route.body, userId: "forged", amountCents: 1 }),
    );

    expect(response.status).toBe(route.status);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(route.useCase).toHaveBeenCalledExactlyOnceWith(route.expected);
  });

  test("requires authentication", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await route.post(request(route.name, route.body));

    expect(response.status).toBe(401);
    expect(route.useCase).not.toHaveBeenCalled();
  });

  test("reports unconfigured server settings as 503", async () => {
    const original = { ...process.env };
    delete process.env.DATABASE_URL;
    try {
      mocks.dependencies.mockResolvedValue(createCommitmentDependencies());

      const response = await route.post(request(route.name, route.body));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" },
      });
    } finally {
      process.env = original;
    }
  });

  test("keeps a dependency setup failure opaque", async () => {
    mocks.dependencies.mockRejectedValue(new Error("pool for postgres://secret"));

    const response = await route.post(request(route.name, route.body));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});

describe("commitment route failures", () => {
  test("an account rejected during authentication is a 403, not a 500", async () => {
    mocks.authenticate.mockRejectedValue(
      new DomainError("INACTIVE_ACCOUNT", "An inactive account cannot use the session API"),
    );

    const response = await commit(request("commit", routes[0].body));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "INACTIVE_ACCOUNT" } });
  });

  test("a missing email reported by the domain is a 403", async () => {
    mocks.commit.mockRejectedValue(
      new DomainError("EMAIL_REQUIRED", "Add an email"),
    );

    const response = await commit(request("commit", routes[0].body));

    expect(response.status).toBe(403);
  });

  test("an unavailable use case is a 503", async () => {
    mocks.withdraw.mockRejectedValue(new SessionManagementUnavailableError());

    const response = await withdraw(request("withdraw", routes[1].body));

    expect(response.status).toBe(503);
  });

  test("errors are not cached", async () => {
    mocks.commit.mockRejectedValue(new DomainError("SESSION_CLOSED", "closed"));

    const response = await commit(request("commit", routes[0].body));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
