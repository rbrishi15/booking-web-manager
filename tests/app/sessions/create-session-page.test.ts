import { beforeEach, expect, test, vi } from "vitest";
import CreateSessionPage from "@/app/sessions/(creation)/create/page";
import { getCurrentUser } from "@/lib/supabase/current-user";

vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/app/sessions/create/create-session-controller", () => ({ CreateSessionController: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const user = { id: "booker", email: "booker@example.com", emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE" as const,
  displayName: "Booker", profileName: "Booker", preferredSports: [], preferredRegions: [], reliabilityScore: 100 };
beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(user));

test("requires sign-in before opening the creation form", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(CreateSessionPage()).rejects.toThrow("redirect:/login?next=%2Fsessions%2Fcreate");
});

test("direct links cannot open the wizard without a verified email", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({ ...user, emailVerified: false });
  await expect(CreateSessionPage()).rejects.toThrow("redirect:/profile/email");
});

test("a verified account receives the actual creation submission action", async () => {
  const page = await CreateSessionPage();
  expect(page.props).toMatchObject({ userId: "booker", action: { name: "submit-session", href: "/api/sessions", method: "POST", inputs: {} } });
});
