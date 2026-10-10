import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { openApiDocument } from "@/app/openapi";
import { joinedSessionsResponseSchema } from "@/app/commit/joined-sessions-contract";
import { createCommitmentDependencies } from "@/use-case-config/commitments";
import { commitmentDependencies } from "./commitment-test-dependencies";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), authenticate: vi.fn(), list: vi.fn() }));
vi.mock("@/app/commit/commitment-server-dependencies", () => ({ getCommitmentDependencies: mocks.dependencies }));
import { GET } from "@/app/api/sessions/joined/route";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const place = {
  sessionId, venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central",
  startAt: new Date("2045-04-02T10:00:00Z"), endAt: new Date("2045-04-02T12:00:00Z"), status: "COMMITTED" as const, bookingShareCents: 1250,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(userId);
  mocks.list.mockResolvedValue([place]);
  mocks.dependencies.mockResolvedValue(commitmentDependencies({ authenticate: mocks.authenticate, listJoinedSessions: { forParticipant: mocks.list } }));
});

const invoke = () => GET(new Request("http://localhost/api/sessions/joined", { headers: { Authorization: "Bearer trusted" } }));

describe("UC2-05 GET joined sessions", () => {
  test("returns the authenticated user's places in the published contract, never cached", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ sessions: [{ ...place, startAt: "2045-04-02T10:00:00.000Z", endAt: "2045-04-02T12:00:00.000Z" }] });
    expect(joinedSessionsResponseSchema.safeParse(body).success).toBe(true);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(userId);
  });

  test("requires authentication before reading", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  test.each([["INACTIVE_ACCOUNT", 403], ["NOT_FOUND", 404]] as const)("maps %s to %s", async (code, status) => {
    mocks.list.mockRejectedValue(new DomainError(code, "Account denied"));

    const response = await invoke();

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "Account denied" } });
  });

  test("reports unconfigured server settings as 503", async () => {
    const original = { ...process.env };
    delete process.env.DATABASE_URL;
    try {
      mocks.dependencies.mockResolvedValue(createCommitmentDependencies());

      const response = await invoke();

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" } });
    } finally {
      process.env = original;
    }
  });

  test.each([
    ["a dependency setup failure", () => mocks.dependencies.mockRejectedValue(new Error("pool for postgres://secret"))],
    ["a database failure", () => mocks.list.mockRejectedValue(new Error("connection to postgres://secret refused"))],
  ])("keeps %s opaque", async (_name, arrange) => {
    arrange();

    const response = await invoke();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  test("is published in the OpenAPI document with every response status", () => {
    const operation = openApiDocument.paths["/api/sessions/joined"]?.get;
    expect(operation?.operationId).toBe("listJoinedSessions");
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "401", "403", "404", "500", "503"]);
  });
});
