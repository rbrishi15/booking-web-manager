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
  const forParticipant = vi.fn<DiscoveryDependencies["discoverSessions"]["forParticipant"]>().mockResolvedValue([]);
  configuration.createDiscoveryDependencies.mockReturnValue({ authenticate, discoverSessions: { forParticipant } });
  const { GET } = await import("@/app/api/sessions/route");
  const { DomainError } = await import("@/domain");
  const { DiscoveryApiUnavailableError } = await import("@/app/discover/discovery-api-unavailable");
  return { authenticate, forParticipant, GET, DomainError, DiscoveryApiUnavailableError };
}

const request = (query = "") => new Request(`http://localhost/api/sessions?${query}`, { headers: { authorization: "Bearer token" } });

describe("GET /api/sessions", () => {
  test("imports without assembling dependencies or authenticating", async () => {
    const { authenticate, forParticipant } = await scenario();

    expect(configuration.createDiscoveryDependencies).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(forParticipant).not.toHaveBeenCalled();
  });

  test("keeps each identity and query together when authentication finishes out of order", async () => {
    const { GET, authenticate, forParticipant } = await scenario();
    const otherUserId = "10000000-0000-4000-8000-000000000002";
    const firstIdentity = Promise.withResolvers<string>();
    const secondIdentity = Promise.withResolvers<string>();
    const firstRequest = request("q=First");
    const secondRequest = request("q=Second");
    authenticate.mockImplementation((req) =>
      req === firstRequest ? firstIdentity.promise : secondIdentity.promise,
    );
    forParticipant.mockImplementation(async (id, criteria) => [{
      sessionId: id,
      venueName: criteria?.text ?? "",
      sport: "Badminton",
      region: "West",
      startAt: new Date("2030-01-02T10:00:00Z"),
      endAt: new Date("2030-01-02T12:00:00Z"),
      totalSlots: 8,
      bookingShareCents: 333,
    }]);

    const firstPending = GET(firstRequest);
    const secondPending = GET(secondRequest);
    secondIdentity.resolve(otherUserId);
    const secondResponse = await secondPending;

    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({
      items: [{ sessionId: otherUserId, venueName: "Second" }],
    });
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith(otherUserId, { text: "Second" });

    firstIdentity.resolve(userId);
    const firstResponse = await firstPending;

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      items: [{ sessionId: userId, venueName: "First" }],
    });
    expect(forParticipant.mock.calls).toEqual([
      [otherUserId, { text: "Second" }],
      [userId, { text: "First" }],
    ]);
    expect(authenticate.mock.calls).toEqual([[firstRequest], [secondRequest]]);
    expect(configuration.createDiscoveryDependencies).toHaveBeenCalledOnce();
  });

  test("authenticates and invokes the use case with validated filter bounds", async () => {
    const { GET, forParticipant, authenticate } = await scenario();
    const req = request("q=+Jurong+&sport=Badminton&region=West&date=2030-01-02&timeFrom=18:00&timeTo=20:00");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(authenticate).toHaveBeenCalledExactlyOnceWith(req);
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith(userId, { text: "Jurong", sport: "Badminton", region: "West", startsWithin: { from: new Date("2030-01-02T10:00:00Z"), before: new Date("2030-01-02T12:00:00Z") } });
  });

  test("serializes safe listing fields and creates an opaque cursor for further matches", async () => {
    const { GET, forParticipant } = await scenario();
    const item = { sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"), totalSlots: 8, bookingShareCents: 333, roomToken: "private", bookerId: "private" };
    const sessions = Array.from({ length: 21 }, (_, index) => ({ ...item, sessionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    forParticipant.mockResolvedValue(sessions);
    const body = await (await GET(request())).json();
    expect(body.items).toHaveLength(20);
    expect(body.items[0]).toEqual({ sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: "2030-01-02T10:00:00.000Z", endAt: "2030-01-02T12:00:00.000Z", totalSlots: 8, bookingShareCents: 333 });
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(atob(body.nextCursor.replace(/-/g, "+").replace(/_/g, "/")))).toEqual({ startAt: item.startAt.toISOString(), sessionId: sessions[19]?.sessionId });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  test("applies an existing HTTP cursor after obtaining matches without paging arguments", async () => {
    const { GET, forParticipant } = await scenario();
    const payload = { startAt: "2030-01-02T10:00:00.000Z", sessionId: userId };
    const nextId = "10000000-0000-4000-8000-000000000002";
    const item = { sessionId: userId, venueName: "Sports hall", sport: "Badminton", region: "West", startAt: new Date(payload.startAt), endAt: new Date("2030-01-02T12:00:00Z"), totalSlots: 8, bookingShareCents: 333 };
    forParticipant.mockResolvedValue([item, { ...item, sessionId: nextId }]);
    const cursor = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const response = await GET(request(`cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith(userId, {});
    expect(await response.json()).toMatchObject({ items: [{ sessionId: nextId }], nextCursor: null });
  });

  test.each(["q=one&q=two", `q=${"a".repeat(101)}`, "sport=Badminton&sport=Tennis", "region=South", "timeTo=19:00", "date=2030-02-30", "cursor=bad"])("rejects invalid query %s before reading the database", async (query) => {
    const { GET, forParticipant, authenticate } = await scenario();
    forParticipant.mockRejectedValue(new Error("Account must not be loaded"));
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    expect(forParticipant).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledOnce();
  });

  test("requires authentication before query validation", async () => {
    const { GET, authenticate, forParticipant } = await scenario();
    authenticate.mockResolvedValue(null);
    const response = await GET(request("region=South"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Authentication is required" } });
    expect(forParticipant).not.toHaveBeenCalled();
  });

  test.each(["INACTIVE_ACCOUNT", "NOT_FOUND"] as const)("maps account rejection %s", async (code) => {
    const { GET, authenticate, forParticipant, DomainError } = await scenario();
    const message = code === "INACTIVE_ACCOUNT" ? "An inactive account cannot use the session API" : "User was not found";
    forParticipant.mockRejectedValue(new DomainError(code, message));
    const response = await GET(request());
    expect(response.status).toBe(code === "INACTIVE_ACCOUNT" ? 403 : 404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, message } });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith(userId, {});
  });

  test("returns the exact unavailable contract", async () => {
    const { GET, authenticate, DiscoveryApiUnavailableError } = await scenario();
    authenticate.mockRejectedValue(new DiscoveryApiUnavailableError());
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "DISCOVERY_API_UNAVAILABLE", message: "Session discovery is not available yet" } });
  });

  test.each(["Error", "DomainError", "DiscoveryApiUnavailableError"])(
    "redacts dependency assembly %s before authentication and retries setup",
    async (kind) => {
      const { GET, authenticate, forParticipant, DomainError, DiscoveryApiUnavailableError } = await scenario();
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
      expect(authenticate).not.toHaveBeenCalled();
      expect(forParticipant).not.toHaveBeenCalled();

      const recovered = await GET(request());
      expect(recovered.status).toBe(200);
      expect(configuration.createDiscoveryDependencies).toHaveBeenCalledTimes(2);
      expect(authenticate).toHaveBeenCalledOnce();
      expect(forParticipant).toHaveBeenCalledOnce();
    },
  );

  test.each(["auth", "forParticipant", "identity", "setup"])("redacts %s failures", async (stage) => {
    const { GET, forParticipant, authenticate } = await scenario();
    const error = new Error("private-database-or-provider-secret");
    if (stage === "auth") authenticate.mockRejectedValue(error);
    if (stage === "forParticipant") forParticipant.mockRejectedValue(error);
    if (stage === "identity") authenticate.mockResolvedValue("invalid-id");
    if (stage === "setup") configuration.createDiscoveryDependencies.mockImplementation(() => { throw error; });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});
