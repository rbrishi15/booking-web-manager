import { beforeEach, describe, expect, test, vi } from "vitest";
import DiscoveryPage from "@/app/discover/page";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { getDiscoveryDependencies } from "@/app/discover/server-dependencies";
import { DomainError } from "@/domain";
import { getCurrentUser } from "@/lib/supabase/current-user";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";
import { encodeDiscoveryCursor } from "@/app/discover/query";

vi.mock("@/app/discover/server-dependencies", () => ({ getDiscoveryDependencies: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/app/discover/_components/discovery-controller", () => ({
  DiscoveryController: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));

const forParticipant = vi.fn<DiscoverSessions["forParticipant"]>();
const authenticate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "viewer", email: "viewer@example.com", displayName: "Viewer", profileName: "Viewer",
    preferredSports: ["Tennis"], preferredRegions: ["East"], reliabilityScore: 100,
  });
  forParticipant.mockResolvedValue([]);
  vi.mocked(getDiscoveryDependencies).mockResolvedValue({ discoverSessions: { forParticipant }, authenticate });
});

function renderPage(params: Record<string, string | string[]> = {}) {
  return DiscoveryPage({ searchParams: Promise.resolve(params) });
}

describe("signed-in discovery server page", () => {
  test("redirects an anonymous request before obtaining discovery access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("redirect:/login?next=%2Fdiscover");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test.each(["INACTIVE_ACCOUNT", "NOT_FOUND"] as const)("redirects a %s account rejected by the use case", async (code) => {
    forParticipant.mockRejectedValue(new DomainError(code, "Account denied"));
    await expect(renderPage()).rejects.toThrow("redirect:/login");
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", {});
  });

  test("fails closed on a user hydration failure", async () => {
    forParticipant.mockRejectedValue(new Error("private infrastructure detail"));
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", {});
  });

  test("validates duplicate URL parameters before querying and retains their distinct controller key", async () => {
    const result = await renderPage({ sport: ["Badminton", "Tennis"] });
    expect(result.props.outcome).toMatchObject({ status: "invalid", fieldErrors: { sport: expect.any(Array) } });
    expect(result.key).toBe("sport=Badminton&sport=Tennis");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
    expect(forParticipant).not.toHaveBeenCalled();
  });

  test("passes Singapore filter bounds directly to the use case without profile defaults", async () => {
    const result = await renderPage({ region: "West", date: "2035-05-12", timeFrom: "18:00", timeTo: "20:00" });
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", { region: "West", startsWithin: { from: new Date("2035-05-12T10:00:00Z"), before: new Date("2035-05-12T12:00:00Z") } });
    expect(result.props.outcome).toEqual({ status: "ready", page: { items: [], nextCursor: null } });
    expect(authenticate).not.toHaveBeenCalled();
    expect(result.props).toMatchObject({ returnTo: "/" });
  });

  test("passes normalized search to the use case while keeping return navigation UI-only", async () => {
    const result = await renderPage({ q: "  Jurong  ", sport: "Badminton", returnTo: "/?region=West&date=2035-05-12" });
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", { text: "Jurong", sport: "Badminton" });
    expect(result.props).toMatchObject({
      returnTo: "/?region=West&date=2035-05-12",
      filters: { q: "Jurong", sport: "Badminton" }, queryKey: "q=Jurong&sport=Badminton",
    });
    expect(result.key).toBe("q=Jurong&sport=Badminton");
  });

  test.each(["https://external.example", "/login", "/discover", ["/wallet", "/profile"]])("falls back to Home for invalid return destination %j without changing the search", async (returnTo) => {
    const result = await renderPage({ q: "Tennis", returnTo });
    expect(result.props.returnTo).toBe("/");
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", { text: "Tennis" });
  });

  test("keeps the default query unfiltered and serializes public result props", async () => {
    forParticipant.mockResolvedValue([{ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: new Date("2035-05-12T10:00:00Z"), endAt: new Date("2035-05-12T12:00:00Z"), totalSlots: 6, bookingShareCents: 750 }]);
    const result = await renderPage();
    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", {});
    expect(result.props.outcome.page.items[0]).toEqual({ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00.000Z", endAt: "2035-05-12T12:00:00.000Z", totalSlots: 6, bookingShareCents: 750 });
  });

  test("applies URL pagination after the use case returns all matching summaries", async () => {
    const startAt = new Date("2035-05-12T10:00:00Z");
    const sessions = Array.from({ length: 41 }, (_, index) => ({
      sessionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      venueName: "Sports hall", sport: "Badminton", region: "West", startAt,
      endAt: new Date("2035-05-12T12:00:00Z"), totalSlots: 6, bookingShareCents: 750,
    }));
    forParticipant.mockResolvedValue(sessions);
    const cursor = encodeDiscoveryCursor({ startAt, sessionId: sessions[19]!.sessionId });

    const result = await renderPage({ sport: "Badminton", cursor });

    expect(forParticipant).toHaveBeenCalledExactlyOnceWith("viewer", { sport: "Badminton" });
    expect(result.props.outcome.page.items.map((item: { sessionId: string }) => item.sessionId))
      .toEqual(sessions.slice(20, 40).map((item) => item.sessionId));
    expect(result.props.outcome.page.nextCursor).toBe(encodeDiscoveryCursor({ startAt, sessionId: sessions[39]!.sessionId }));
  });

  test.each([
    { error: new DiscoveryApiUnavailableError(), kind: "unavailable" },
    { error: new Error("private database credentials"), kind: "unexpected" },
  ])("maps discovery failures to opaque $kind states", async ({ error, kind }) => {
    forParticipant.mockRejectedValue(error);
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind });
  });
});
