import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), run: vi.fn() }));
vi.mock("@/app/commit/scheduled-jobs-server-dependencies", () => ({
  getScheduledJobsDependencies: mocks.dependencies,
}));
import { GET } from "@/app/api/cron/commitments/route";
import { openApiDocument } from "@/app/openapi";
import { createScheduledJobsDependencies } from "@/use-case-config/scheduled-jobs";

const report = {
  runId: "run-1",
  sessionsChecked: 0,
  forfeitureDue: [],
  promoted: [],
  autoVerified: [],
  verificationReminders: [],
  failures: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockResolvedValue(report);
  mocks.dependencies.mockResolvedValue({
    cronSecret: "cron-secret",
    ids: { next: () => "run-1" },
    runner: { run: mocks.run },
  });
});

function get(authorization?: string): Promise<Response> {
  return GET(
    new Request("http://localhost/api/cron/commitments", {
      headers: authorization ? { Authorization: authorization } : {},
    }),
  );
}

describe("GET /api/cron/commitments", () => {
  test("runs the sweep for the scheduler's bearer secret", async () => {
    const response = await get("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith("run-1");
  });

  test.each([undefined, "Bearer wrong", "Bearer user-jwt"])(
    "rejects %s without running",
    async (authorization) => {
      const response = await get(authorization);

      expect(response.status).toBe(401);
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );

  test("each accepted call is a new run, uncached", async () => {
    let next = 0;
    mocks.dependencies.mockResolvedValue({
      cronSecret: "cron-secret",
      ids: { next: () => `run-${++next}` },
      runner: { run: mocks.run },
    });

    const first = await get("Bearer cron-secret");
    await get("Bearer cron-secret");

    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(mocks.run.mock.calls).toEqual([["run-1"], ["run-2"]]);
  });

  test("a blank configured secret rejects an empty bearer", async () => {
    mocks.dependencies.mockResolvedValue({
      cronSecret: "  ",
      ids: { next: () => "run-1" },
      runner: { run: mocks.run },
    });

    expect((await get("Bearer   ")).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  test("a failed sweep is an opaque 500", async () => {
    mocks.run.mockRejectedValue(new Error("connection refused at 10.0.0.1"));

    const response = await get("Bearer cron-secret");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  test("keeps a dependency setup failure opaque", async () => {
    mocks.dependencies.mockRejectedValue(new Error("pool for postgres://secret"));

    const response = await get("Bearer cron-secret");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  test("without CRON_SECRET, configuration authorizes nothing", async () => {
    const original = { ...process.env };
    delete process.env.CRON_SECRET;
    try {
      mocks.dependencies.mockResolvedValue(createScheduledJobsDependencies());

      expect((await get("Bearer ")).status).toBe(401);
      expect((await get("Bearer undefined")).status).toBe(401);
    } finally {
      process.env = original;
    }
  });

  test("without database settings, an authorized run fails opaquely", async () => {
    const original = { ...process.env };
    process.env.CRON_SECRET = "cron-secret";
    delete process.env.DATABASE_URL;
    try {
      mocks.dependencies.mockResolvedValue(createScheduledJobsDependencies());

      const response = await get("Bearer cron-secret");

      expect(response.status).toBe(500);
    } finally {
      process.env = original;
    }
  });

  test("is documented as mounted", () => {
    const operation = openApiDocument.paths["/api/cron/commitments"]?.get;

    expect(operation?.description).not.toContain("no Next.js route is mounted");
    expect(operation?.security).toEqual([{ cronAuth: [] }]);
  });
});
