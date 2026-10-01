import { beforeEach, describe, expect, test, vi } from "vitest";
import DiscoveryPage from "@/app/discover/page";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { getDiscoveryDependencies } from "@/app/discover/server-dependencies";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

vi.mock("@/app/discover/server-dependencies", () => ({ getDiscoveryDependencies: vi.fn() }));
vi.mock("@/lib/supabase/account-status", () => ({ getAccountStatus: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/app/discover/_components/discovery-controller", () => ({
  DiscoveryController: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));

const search = vi.fn<DiscoverSessions["search"]>();
const authenticate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "viewer", email: "viewer@example.com", displayName: "Viewer", profileName: "Viewer",
    preferredSports: ["Tennis"], preferredRegions: ["East"], reliabilityScore: 100,
  });
  vi.mocked(getAccountStatus).mockResolvedValue({ kind: "active" });
  vi.mocked(createClient).mockResolvedValue({} as never);
  search.mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(getDiscoveryDependencies).mockResolvedValue({ discoverSessions: { search }, authenticate });
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

  test.each(["inactive", "missing-profile"] as const)("rejects a %s account even with a verified identity", async (kind) => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind });
    await expect(renderPage()).rejects.toThrow("redirect:/login");
    expect(getAccountStatus).toHaveBeenCalledWith(expect.anything(), "viewer");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("fails closed on a fresh account-status lookup failure", async () => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind: "lookup-failed", code: "unavailable", message: "private infrastructure detail" });
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("validates duplicate URL parameters before querying and retains their distinct controller key", async () => {
    const result = await renderPage({ sport: ["Badminton", "Tennis"] });
    expect(result.props.outcome).toMatchObject({ status: "invalid", fieldErrors: { sport: expect.any(Array) } });
    expect(result.key).toBe("sport=Badminton&sport=Tennis");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("passes Singapore filter bounds directly to the use case without profile defaults", async () => {
    const result = await renderPage({ region: "West", date: "2035-05-12", timeFrom: "18:00", timeTo: "20:00" });
    expect(search).toHaveBeenCalledWith({ region: "West", startAtFrom: new Date("2035-05-12T10:00:00Z"), startAtBefore: new Date("2035-05-12T12:00:00Z") });
    expect(result.props.outcome).toEqual({ status: "ready", page: { items: [], nextCursor: null } });
    expect(authenticate).not.toHaveBeenCalled();
    expect(result.props).toMatchObject({ pathname: "/discover", presentation: "search", returnTo: "/" });
  });

  test("passes normalized search to the reader while keeping return navigation UI-only", async () => {
    const result = await renderPage({ q: "  Jurong  ", sport: "Badminton", returnTo: "/?region=West&date=2035-05-12" });
    expect(search).toHaveBeenCalledExactlyOnceWith({ q: "Jurong", sport: "Badminton" });
    expect(result.props).toMatchObject({
      pathname: "/discover", presentation: "search", returnTo: "/?region=West&date=2035-05-12",
      filters: { q: "Jurong", sport: "Badminton" }, queryKey: "q=Jurong&sport=Badminton",
    });
    expect(result.key).toBe("q=Jurong&sport=Badminton");
  });

  test.each(["https://external.example", "/login", "/discover", ["/wallet", "/profile"]])("falls back to Home for invalid return destination %j without changing the search", async (returnTo) => {
    const result = await renderPage({ q: "Tennis", returnTo });
    expect(result.props.returnTo).toBe("/");
    expect(search).toHaveBeenCalledExactlyOnceWith({ q: "Tennis" });
  });

  test("keeps the default query unfiltered and serializes public result props", async () => {
    search.mockResolvedValue({
      items: [{ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: new Date("2035-05-12T10:00:00Z"), endAt: new Date("2035-05-12T12:00:00Z"), totalSlots: 6, bookingShareCents: 750 }],
      nextCursor: null,
    });
    const result = await renderPage();
    expect(search).toHaveBeenCalledWith({});
    expect(result.props.outcome.page.items[0]).toEqual({ sessionId: "public-session", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00.000Z", endAt: "2035-05-12T12:00:00.000Z", totalSlots: 6, bookingShareCents: 750 });
  });

  test.each([
    { error: new DiscoveryApiUnavailableError(), kind: "unavailable" },
    { error: new Error("private database credentials"), kind: "unexpected" },
  ])("maps discovery failures to opaque $kind states", async ({ error, kind }) => {
    search.mockRejectedValue(error);
    const result = await renderPage();
    expect(result.props.outcome).toEqual({ status: "error", kind });
  });
});
