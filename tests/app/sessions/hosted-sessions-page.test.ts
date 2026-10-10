import { beforeEach, describe, expect, test, vi } from "vitest";
import SessionsPage, { dynamic } from "@/app/sessions/(manage)/page";
import { HostedSessionsController } from "@/app/sessions/_components/hosted-sessions-controller";
import { getSessionManagementDependencies } from "@/app/sessions/management-server-dependencies";
import { getCurrentUser } from "@/lib/supabase/current-user";

vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: vi.fn() }));
vi.mock("@/app/sessions/_components/hosted-sessions-controller", () => ({ HostedSessionsController: () => null }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const user = {
  id: "booker", email: "booker@example.com", emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE" as const, displayName: "Booker", profileName: "Booker",
  preferredSports: [], preferredRegions: [], reliabilityScore: 100,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});

/** The page wraps the controller in the query provider; returns the controller element. */
async function renderController() {
  const page = await SessionsPage();
  const controller = page.props.children;
  expect(controller.type).toBe(HostedSessionsController);
  return controller;
}

describe("hosted Sessions page", () => {
  test("requires cookie identity before rendering the sessions screen", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(SessionsPage()).rejects.toThrow("redirect:/login?next=%2Fsessions");
    expect(dynamic).toBe("force-dynamic");
  });

  test("loads session data through the API in the browser, not through use cases on the server", async () => {
    const controller = await renderController();
    expect(controller.props.userId).toBe("booker");
    expect(controller.props.actions).toEqual([{ name: "create-session", href: "/sessions/create", method: "GET", inputs: {} }]);
    expect(controller.props).not.toHaveProperty("outcome");
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
  });

  test("unverified users receive the email recovery action", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ ...user, emailVerified: false });
    expect((await renderController()).props.actions).toEqual([{ name: "verify-email", href: "/profile/email", method: "GET", inputs: {} }]);
  });
});
