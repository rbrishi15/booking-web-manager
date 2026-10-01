import { beforeEach, describe, expect, test, vi } from "vitest";
import HomePage, { dynamic } from "@/app/page";
import { LandingView } from "@/app/_components/landing-view";
import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { DiscoveryController } from "@/app/discover/_components/discovery-controller";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { getDiscoveryDependencies } from "@/app/discover/server-dependencies";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

vi.mock("@/app/_components/landing-view", () => ({ LandingView: () => null }));
vi.mock("@/app/(auth)/_components/signed-in-shell", () => ({ SignedInShell: () => null }));
vi.mock("@/app/discover/_components/discovery-controller", () => ({ DiscoveryController: () => null }));
vi.mock("@/app/discover/server-dependencies", () => ({ getDiscoveryDependencies: vi.fn() }));
vi.mock("@/lib/supabase/account-status", () => ({ getAccountStatus: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/is-configured", () => ({ isAuthenticationConfigured: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const search = vi.fn<DiscoverSessions["search"]>();
const authenticate = vi.fn();
const renderPage = (params: Record<string, string | string[]> = {}) => HomePage({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAuthenticationConfigured).mockReturnValue(true);
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "viewer", email: "viewer@example.com", displayName: "Viewer", profileName: "Viewer",
    preferredSports: ["Tennis"], preferredRegions: ["East"], reliabilityScore: 100,
  });
  vi.mocked(getAccountStatus).mockResolvedValue({ kind: "active" });
  vi.mocked(createClient).mockResolvedValue({} as never);
  search.mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(getDiscoveryDependencies).mockResolvedValue({ discoverSessions: { search }, authenticate });
});

describe("authentication-aware index page", () => {
  test("is dynamic and serves the landing without initialized authentication or database settings", async () => {
    vi.mocked(isAuthenticationConfigured).mockReturnValue(false);
    const result = await renderPage({ sport: "Tennis" });
    expect(dynamic).toBe("force-dynamic");
    expect(result.type).toBe(LandingView);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(getAccountStatus).not.toHaveBeenCalled();
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("serves anonymous visitors the landing without acquiring session access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const result = await renderPage({ date: "invalid" });
    expect(result.type).toBe(LandingView);
    expect(getAccountStatus).not.toHaveBeenCalled();
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("shows active users the existing Home composition with an unfiltered default", async () => {
    const result = await renderPage();
    expect(result.type).toBe(SignedInShell);
    const controller = result.props.children;
    expect(controller.type).toBe(DiscoveryController);
    expect(controller.props).toMatchObject({
      pathname: "/", presentation: "home", queryKey: "",
      outcome: { status: "ready", page: { items: [], nextCursor: null } },
    });
    expect(getAccountStatus).toHaveBeenCalledWith(expect.anything(), "viewer");
    expect(search).toHaveBeenCalledExactlyOnceWith({});
    expect(authenticate).not.toHaveBeenCalled();
  });

  test("keeps committed Home filters and paging on the root controller", async () => {
    const result = await renderPage({ region: "West", date: "2035-05-12" });
    expect(result.props.children.key).toBe("region=West&date=2035-05-12");
    expect(result.props.children.props.pathname).toBe("/");
    expect(search).toHaveBeenCalledWith({
      region: "West", startAtFrom: new Date("2035-05-11T16:00:00Z"), startAtBefore: new Date("2035-05-12T16:00:00Z"),
    });
  });

  test.each(["inactive", "missing-profile"] as const)("redirects a verified %s account before querying sessions", async (kind) => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind });
    await expect(renderPage()).rejects.toThrow("redirect:/login");
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  test("shows an opaque failure when active-account access cannot be verified", async () => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind: "lookup-failed", code: "unavailable", message: "private infrastructure detail" });
    const result = await renderPage();
    expect(result.props.children.props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test("renders invalid Home filters without querying the reader", async () => {
    const result = await renderPage({ date: "invalid" });
    expect(result.props.children.props.outcome).toMatchObject({ status: "invalid", fieldErrors: { date: expect.any(Array) } });
    expect(getDiscoveryDependencies).not.toHaveBeenCalled();
  });

  test.each([
    { error: new DiscoveryApiUnavailableError(), kind: "unavailable" },
    { error: new Error("private database detail"), kind: "unexpected" },
  ])("renders $kind within the Home shell without exposing service details", async ({ error, kind }) => {
    search.mockRejectedValue(error);
    const result = await renderPage();
    expect(result.type).toBe(SignedInShell);
    expect(result.props.children.props.outcome).toEqual({ status: "error", kind });
  });
});
