import { beforeEach, describe, expect, test, vi } from "vitest";
import DiscoveryPage from "@/app/discover/page";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { getDiscoveryDependencies } from "@/app/discover/server-dependencies";
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

const searchPublic = vi.fn<DiscoverSessions["searchPublic"]>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "viewer", email: "viewer@example.com", emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE", displayName: "Viewer", profileName: "Viewer",
    preferredSports: ["Tennis"], preferredRegions: ["East"], reliabilityScore: 100,
  });
  searchPublic.mockResolvedValue([]);
  vi.mocked(getDiscoveryDependencies).mockResolvedValue({ discoverSessions: { searchPublic } });
});

function renderPage(params: Record<string, string | string[]> = {}) {
  return DiscoveryPage({ searchParams: Promise.resolve(params) });
}

describe("public discovery server page", () => {
  test("renders anonymous results without consulting authentication", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "ready", page: { items: [], nextCursor: null } });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test("shows an opaque error on a database failure", async () => {
    searchPublic.mockRejectedValue(new Error("private infrastructure detail"));
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( {});
  });

  test("validates duplicate URL parameters before querying and retains their distinct controller key", async () => {
    const result = await renderPage({ sport: ["Badminton", "Tennis"] });
    expect(result.props.outcome).toMatchObject({ status: "invalid", fieldErrors: { sport: expect.any(Array) } });
    expect(result.key).toBe("sport=Badminton&sport=Tennis");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
    expect(searchPublic).not.toHaveBeenCalled();
  });

  test("passes Singapore filter bounds directly to the use case without profile defaults", async () => {
    const result = await renderPage({ region: "West", date: "2035-05-12", timeFrom: "18:00", timeTo: "20:00" });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( { region: "West", startsWithin: { from: new Date("2035-05-12T10:00:00Z"), before: new Date("2035-05-12T12:00:00Z") } });
    expect(result.props.outcome).toEqual({ status: "ready", page: { items: [], nextCursor: null } });
    expect(result.props).toMatchObject({ returnTo: "/" });
  });

  test("passes normalized search to the use case while keeping return navigation UI-only", async () => {
    const result = await renderPage({ q: "  Jurong  ", sport: "Badminton", returnTo: "/?region=West&date=2035-05-12" });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( { text: "Jurong", sport: "Badminton" });
    expect(result.props).toMatchObject({
      returnTo: "/?region=West&date=2035-05-12",
      filters: { q: "Jurong", sport: "Badminton" }, queryKey: "q=Jurong&sport=Badminton",
    });
    expect(result.key).toBe("q=Jurong&sport=Badminton");
  });

  test.each(["https://external.example", "/login", "/discover", ["/wallet", "/profile"]])("falls back to Home for invalid return destination %j without changing the search", async (returnTo) => {
    const result = await renderPage({ q: "Tennis", returnTo });
    expect(result.props.returnTo).toBe("/");
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( { text: "Tennis" });
  });

  test("keeps the default query unfiltered and serializes public result props", async () => {
    searchPublic.mockResolvedValue([{ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: new Date("2035-05-12T10:00:00Z"), endAt: new Date("2035-05-12T12:00:00Z"), totalSlots: 6, bookingShareCents: 750 }]);
    const result = await renderPage();
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( {});
    expect(result.props.outcome.page.items[0]).toEqual({ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00.000Z", endAt: "2035-05-12T12:00:00.000Z", totalSlots: 6, bookingShareCents: 750 });
  });

  test("applies URL pagination after the use case returns all matching summaries", async () => {
    const startAt = new Date("2035-05-12T10:00:00Z");
    const sessions = Array.from({ length: 41 }, (_, index) => ({
      sessionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      venueName: "Sports hall", sport: "Badminton", region: "West", startAt,
      endAt: new Date("2035-05-12T12:00:00Z"), totalSlots: 6, bookingShareCents: 750,
    }));
    searchPublic.mockResolvedValue(sessions);
    const cursor = encodeDiscoveryCursor({ startAt, sessionId: sessions[19]!.sessionId });

    const result = await renderPage({ sport: "Badminton", cursor });

    expect(searchPublic).toHaveBeenCalledExactlyOnceWith( { sport: "Badminton" });
    expect(result.props.outcome.page.items.map((item: { sessionId: string }) => item.sessionId))
      .toEqual(sessions.slice(20, 40).map((item) => item.sessionId));
    expect(result.props.outcome.page.nextCursor).toBe(encodeDiscoveryCursor({ startAt, sessionId: sessions[39]!.sessionId }));
  });

  test.each([
    { error: new DiscoveryApiUnavailableError(), kind: "unavailable" },
    { error: new Error("private database credentials"), kind: "unexpected" },
  ])("maps discovery failures to opaque $kind states", async ({ error, kind }) => {
    searchPublic.mockRejectedValue(error);
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind });
  });
});
