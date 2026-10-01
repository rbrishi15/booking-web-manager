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
  const authenticate = vi.fn<DiscoveryDependencies["authenticate"]>().mockResolvedValue(userId);
  const search = vi.fn<DiscoveryDependencies["discoverSessions"]["search"]>().mockResolvedValue({ items: [], nextCursor: null });
  configuration.createDiscoveryDependencies.mockReturnValue({ authenticate, discoverSessions: { search } });
  const { GET } = await import("@/app/api/sessions/route");
  const { DomainError } = await import("@/domain");
  const { DiscoveryApiUnavailableError } = await import("@/app/discover/discovery-api-unavailable");
  return { authenticate, search, GET, DomainError, DiscoveryApiUnavailableError };
}

const request = (query = "") => new Request(`http://localhost/api/sessions?${query}`, { headers: { authorization: "Bearer token" } });

describe("GET /api/sessions", () => {
  test("authenticates and invokes the use case with validated filter bounds", async () => {
    const { GET, search, authenticate } = await scenario();
    const req = request("sport=Badminton&region=West&date=2030-01-02&timeFrom=18:00&timeTo=20:00");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(authenticate).toHaveBeenCalledExactlyOnceWith(req);
    expect(search).toHaveBeenCalledExactlyOnceWith({ sport: "Badminton", region: "West", startAtFrom: new Date("2030-01-02T10:00:00Z"), startAtBefore: new Date("2030-01-02T12:00:00Z") });
  });

  test("serializes safe listing fields and an opaque cursor", async () => {
    const { GET, search } = await scenario();
    const item = { sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"), totalSlots: 8, bookingShareCents: 333, roomToken: "private", bookerId: "private" };
    search.mockResolvedValue({ items: [item], nextCursor: { startAt: item.startAt.toISOString(), sessionId: userId } });
    const body = await (await GET(request())).json();
    expect(body.items).toEqual([{ sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: "2030-01-02T10:00:00.000Z", endAt: "2030-01-02T12:00:00.000Z", totalSlots: 8, bookingShareCents: 333 }]);
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(body)).not.toContain("private");
  });

  test.each(["sport=Badminton&sport=Tennis", "region=South", "timeTo=19:00", "date=2030-02-30", "cursor=bad"])("rejects invalid query %s before reading the database", async (query) => {
    const { GET, search } = await scenario();
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    expect(search).not.toHaveBeenCalled();
  });

  test("requires authentication before query validation", async () => {
    const { GET, authenticate, search } = await scenario();
    authenticate.mockResolvedValue(null);
    const response = await GET(request("region=South"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Authentication is required" } });
    expect(search).not.toHaveBeenCalled();
  });

  test.each(["INACTIVE_ACCOUNT", "NOT_FOUND"] as const)("maps account rejection %s", async (code) => {
    const { GET, authenticate, search, DomainError } = await scenario();
    authenticate.mockRejectedValue(new DomainError(code, "Account denied"));
    const response = await GET(request());
    expect(response.status).toBe(code === "INACTIVE_ACCOUNT" ? 403 : 404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, message: "Account denied" } });
    expect(search).not.toHaveBeenCalled();
  });

  test("returns the exact unavailable contract", async () => {
    const { GET, authenticate, DiscoveryApiUnavailableError } = await scenario();
    authenticate.mockRejectedValue(new DiscoveryApiUnavailableError());
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "DISCOVERY_API_UNAVAILABLE", message: "Session discovery is not available yet" } });
  });

  test.each(["auth", "search", "identity", "setup"])("redacts %s failures", async (stage) => {
    const { GET, search, authenticate } = await scenario();
    const error = new Error("private-database-or-provider-secret");
    if (stage === "auth") authenticate.mockRejectedValue(error);
    if (stage === "search") search.mockRejectedValue(error);
    if (stage === "identity") authenticate.mockResolvedValue("invalid-id");
    if (stage === "setup") configuration.createDiscoveryDependencies.mockImplementation(() => { throw error; });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});
