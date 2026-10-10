import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import EmailVerificationPage from "@/app/profile/email/page";
import { getCurrentUser } from "@/lib/supabase/current-user";

vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const user = {
  id: "viewer", email: "viewer@example.com", emailVerified: false, accountStatus: "ACTIVE" as const,
  pendingEmail: null, displayName: "Viewer", profileName: "Viewer", preferredSports: [], preferredRegions: [], reliabilityScore: 100,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});

test("unconfirmed accounts can create sessions without using email recovery", async () => {
  const html = renderToStaticMarkup(await EmailVerificationPage({ searchParams: Promise.resolve({ verification: "failed" }) }));
  expect(html).toContain("Resend confirmation email");
  expect(html).toContain('href="/discover"');
  expect(html).toContain("finish that confirmation link");
  expect(html).toContain('href="/sessions/create"');
});

test("freshly verified page state offers creation and removes email-recovery forms", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({ ...user, emailVerified: true });
  const html = renderToStaticMarkup(await EmailVerificationPage({ searchParams: Promise.resolve({ verification: "failed" }) }));
  expect(html).toContain('href="/sessions/create"');
  expect(html).toContain("Your email address is verified");
  expect(html).not.toContain("Resend confirmation email");
  expect(html).not.toContain("finish that confirmation link");
});

test("a missing email can be added without signing out", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({ ...user, email: null });
  const html = renderToStaticMarkup(await EmailVerificationPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Add an email address");
  expect(html).toContain('name="email"');
});

test("a signed-out request retains a safe login return path", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  await expect(EmailVerificationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login?next=%2Fprofile%2Femail");
});
