import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({ createDiscoveryDependencies: vi.fn<() => DiscoveryDependencies>() }));
vi.mock("@/use-case-config/discovery", () => configuration);
const userId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetModules();
  configuration.createDiscoveryDependencies.mockReset();
});

async function scenario() {
  const searchPublic = vi.fn<DiscoveryDependencies["discoverSessions"]["searchPublic"]>().mockResolvedValue([]);
  configuration.createDiscoveryDependencies.mockReturnValue({ discoverSessions: { searchPublic } });
  const { GET } = await import("@/app/api/sessions/route");
  const { DomainError } = await import("@/domain");
  const { DiscoveryApiUnavailableError } = await import("@/app/discover/discovery-api-unavailable");
  return { searchPublic, GET, DomainError, DiscoveryApiUnavailableError };
}

const request = (query = "") => new Request(`http://localhost/api/sessions?${query}`, { headers: { authorization: "Bearer token" } });

describe("GET /api/sessions", () => {
  test("imports without assembling dependencies or authenticating", async () => {
    const { searchPublic } = await scenario();

    expect(configuration.createDiscoveryDependencies).not.toHaveBeenCalled();
    expect(searchPublic).not.toHaveBeenCalled();
  });

  test("invokes public discovery with validated filter bounds", async () => {
    const { GET, searchPublic } = await scenario();
    const req = request("q=+Jurong+&sport=Badminton&region=West&date=2030-01-02&timeFrom=18:00&timeTo=20:00");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith({ text: "Jurong", sport: "Badminton", region: "West", startsWithin: { from: new Date("2030-01-02T10:00:00Z"), before: new Date("2030-01-02T12:00:00Z") } });
  });

  test("serializes safe listing fields and creates an opaque cursor for further matches", async () => {
    const { GET, searchPublic } = await scenario();
    const item = { sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"), totalSlots: 8, bookingShareCents: 333, roomToken: "private", bookerId: "private" };
    const sessions = Array.from({ length: 21 }, (_, index) => ({ ...item, sessionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    searchPublic.mockResolvedValue(sessions);
    const body = await (await GET(request())).json();
    expect(body.items).toHaveLength(20);
    expect(body.items[0]).toEqual({ sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: "2030-01-02T10:00:00.000Z", endAt: "2030-01-02T12:00:00.000Z", totalSlots: 8, bookingShareCents: 333 });
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(atob(body.nextCursor.replace(/-/g, "+").replace(/_/g, "/")))).toEqual({ startAt: item.startAt.toISOString(), sessionId: sessions[19]?.sessionId });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  test("applies an existing HTTP cursor after obtaining matches without paging arguments", async () => {
    const { GET, searchPublic } = await scenario();
    const payload = { startAt: "2030-01-02T10:00:00.000Z", sessionId: userId };
    const nextId = "10000000-0000-4000-8000-000000000002";
    const item = { sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: new Date(payload.startAt), endAt: new Date("2030-01-02T12:00:00Z"), totalSlots: 8, bookingShareCents: 333 };
    searchPublic.mockResolvedValue([item, { ...item, sessionId: nextId }]);
    const cursor = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const response = await GET(request(`cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith({});
    expect(await response.json()).toMatchObject({ items: [{ sessionId: nextId }], nextCursor: null });
  });

  test.each(["q=one&q=two", `q=${"a".repeat(101)}`, "sport=Badminton&sport=Tennis", "region=South", "timeTo=19:00", "date=2030-02-30", "cursor=bad"])("rejects invalid query %s before reading the database", async (query) => {
    const { GET, searchPublic } = await scenario();
    searchPublic.mockRejectedValue(new Error("Database must not be read"));
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    expect(searchPublic).not.toHaveBeenCalled();
  });

  test("returns the exact unavailable contract", async () => {
    const { GET, searchPublic, DiscoveryApiUnavailableError } = await scenario();
    searchPublic.mockRejectedValue(new DiscoveryApiUnavailableError());
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "DISCOVERY_API_UNAVAILABLE", message: "Session discovery is not available yet" } });
  });

  test.each(["Error", "DomainError", "DiscoveryApiUnavailableError"])(
    "redacts dependency assembly %s before query execution and retries setup",
    async (kind) => {
      const { GET, searchPublic, DomainError, DiscoveryApiUnavailableError } = await scenario();
      const failure = kind === "DomainError"
        ? new DomainError("INACTIVE_ACCOUNT", "private-discovery-setup-failure")
        : kind === "DiscoveryApiUnavailableError"
          ? new DiscoveryApiUnavailableError()
          : new Error("private-discovery-setup-failure");
      configuration.createDiscoveryDependencies.mockImplementationOnce(() => { throw failure; });

      const response = await GET(request());

      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      expect(searchPublic).not.toHaveBeenCalled();

      const recovered = await GET(request());
      expect(recovered.status).toBe(200);
      expect(configuration.createDiscoveryDependencies).toHaveBeenCalledTimes(2);
      expect(searchPublic).toHaveBeenCalledOnce();
    },
  );

  test.each(["searchPublic", "setup"])("redacts %s failures", async (stage) => {
    const { GET, searchPublic } = await scenario();
    const error = new Error("private-database-or-provider-secret");
    if (stage === "searchPublic") searchPublic.mockRejectedValue(error);
    if (stage === "setup") configuration.createDiscoveryDependencies.mockImplementation(() => { throw error; });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});
