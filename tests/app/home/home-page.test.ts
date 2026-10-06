import { beforeEach, describe, expect, test, vi } from "vitest";
import HomePage, { dynamic } from "@/app/page";
import { LandingView } from "@/app/_components/landing-view";
import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { HomeController } from "@/app/home/_components/home-controller";
import { HomeUnavailableError } from "@/app/home/dependencies";
import { getHomeDependencies } from "@/app/home/server-dependencies";
import type { WeatherState } from "@/app/home/types";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { createClient } from "@/lib/supabase/server";
import type { ListUpcomingBookings } from "@/use-cases/sessions/ListUpcomingBookings";

vi.mock("@/app/_components/landing-view", () => ({ LandingView: () => null }));
vi.mock("@/app/(auth)/_components/signed-in-shell", () => ({ SignedInShell: () => null }));
vi.mock("@/app/home/_components/home-controller", () => ({ HomeController: () => null }));
vi.mock("@/app/home/server-dependencies", () => ({ getHomeDependencies: vi.fn() }));
vi.mock("@/lib/supabase/account-status", () => ({ getAccountStatus: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/is-configured", () => ({ isAuthenticationConfigured: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const list = vi.fn<ListUpcomingBookings["list"]>();
const weather = vi.fn<() => Promise<WeatherState>>();
const forecast: WeatherState = {
  status: "ready", forecast: "Fair", lowCelsius: 25, highCelsius: 32,
  validFrom: "2042-08-01T16:00:00Z", validTo: "2042-08-02T16:00:00Z", updatedAt: "2042-08-01T15:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAuthenticationConfigured).mockReturnValue(true);
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "viewer", email: "viewer@example.com", displayName: "Viewer", profileName: "Viewer",
    emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE",
    preferredSports: ["Tennis"], preferredRegions: ["East"], reliabilityScore: 100,
  });
  vi.mocked(getAccountStatus).mockResolvedValue({ kind: "active" });
  vi.mocked(createClient).mockResolvedValue({} as never);
  list.mockResolvedValue([]);
  weather.mockResolvedValue(forecast);
  vi.mocked(getHomeDependencies).mockResolvedValue({ upcomingBookings: { list }, weather });
});

describe("authentication-aware personal Home page", () => {
  test("is dynamic and serves the landing without configured authentication or database access", async () => {
    vi.mocked(isAuthenticationConfigured).mockReturnValue(false);
    const result = await HomePage();
    expect(dynamic).toBe("force-dynamic");
    expect(result.type).toBe(LandingView);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(getAccountStatus).not.toHaveBeenCalled();
    expect(getHomeDependencies).not.toHaveBeenCalled();
    expect(weather).not.toHaveBeenCalled();
  });

  test("serves anonymous visitors the landing without personal session or weather reads", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const result = await HomePage();
    expect(result.type).toBe(LandingView);
    expect(getAccountStatus).not.toHaveBeenCalled();
    expect(getHomeDependencies).not.toHaveBeenCalled();
    expect(weather).not.toHaveBeenCalled();
  });

  test("uses only the active cookie identity and renders safe bookings without querying weather", async () => {
    list.mockResolvedValue([{
      sessionId: "session", venueName: "West Sports Hall", sport: "Badminton", region: "West",
      startAt: new Date("2042-08-02T10:00:00Z"), endAt: new Date("2042-08-02T11:00:00Z"),
    }]);
    const result = await HomePage();
    expect(result.type).toBe(SignedInShell);
    expect(result.props.children.type).toBe(HomeController);
    expect(result.props.children.props).toEqual({ outcome: {
      status: "ready", bookings: [{
        sessionId: "session", venueName: "West Sports Hall", sport: "Badminton", region: "West",
        startAt: "2042-08-02T10:00:00.000Z", endAt: "2042-08-02T11:00:00.000Z",
      }],
    } });
    expect(getAccountStatus).toHaveBeenCalledWith(expect.anything(), "viewer");
    expect(list).toHaveBeenCalledExactlyOnceWith("viewer");
    expect(weather).not.toHaveBeenCalled();
  });

  test("loads the forecast only after a successful empty booking read", async () => {
    const result = await HomePage();
    expect(result.props.children.props.outcome).toEqual({ status: "empty", weather: forecast });
    expect(list).toHaveBeenCalledExactlyOnceWith("viewer");
    expect(weather).toHaveBeenCalledExactlyOnceWith();
    expect(list.mock.invocationCallOrder[0]).toBeLessThan(weather.mock.invocationCallOrder[0]!);
  });

  test.each(["unavailable", "rejected"])("preserves the empty diary when weather is %s", async (kind) => {
    if (kind === "unavailable") weather.mockResolvedValue({ status: "unavailable" });
    else weather.mockRejectedValue(new Error("private weather endpoint failure"));
    const result = await HomePage();
    expect(result.props.children.props.outcome).toEqual({ status: "empty", weather: { status: "unavailable" } });
  });

  test.each(["inactive", "missing-profile"] as const)("redirects a verified %s account before personal or weather reads", async (kind) => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind });
    await expect(HomePage()).rejects.toThrow("redirect:/login");
    expect(getHomeDependencies).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(weather).not.toHaveBeenCalled();
  });

  test("fails closed without personal or weather reads when account access cannot be verified", async () => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind: "lookup-failed", code: "unavailable", message: "private infrastructure detail" });
    const result = await HomePage();
    expect(result.props.children.props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getHomeDependencies).not.toHaveBeenCalled();
    expect(weather).not.toHaveBeenCalled();
  });

  test.each([
    { error: new HomeUnavailableError(), kind: "unavailable" },
    { error: new Error("private database detail"), kind: "unexpected" },
  ])("shows $kind instead of an empty diary or forecast when the booking read fails", async ({ error, kind }) => {
    list.mockRejectedValue(error);
    const result = await HomePage();
    expect(result.type).toBe(SignedInShell);
    expect(result.props.children.props.outcome).toEqual({ status: "error", kind });
    expect(weather).not.toHaveBeenCalled();
  });
});
