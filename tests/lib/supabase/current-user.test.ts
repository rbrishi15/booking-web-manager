import { beforeEach, expect, test, vi } from "vitest";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";

vi.mock("react", () => ({ cache: (callback: unknown) => callback }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

function authUser(user: Record<string, unknown>, profile: Record<string, unknown> | null = { account_status: "ACTIVE" }, authError: unknown = null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "viewer", ...user } }, error: authError }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
  } as never);
}

test("a phone-confirmed account still needs to verify its current email", async () => {
  authUser({ email: "viewer@example.com", confirmed_at: "2026-10-03T00:00:00Z", phone_confirmed_at: "2026-10-03T00:00:00Z" });
  expect(await getCurrentUser()).toMatchObject({ email: "viewer@example.com", emailVerified: false, accountStatus: "ACTIVE", pendingEmail: null });
});

test("ignores user-editable verification metadata and keeps a pending email separate", async () => {
  authUser({ email: "", new_email: "pending@example.com", user_metadata: { email_verified: true } });
  expect(await getCurrentUser()).toMatchObject({ email: null, emailVerified: false, pendingEmail: "pending@example.com", displayName: "Your account" });
});

test("recognizes a confirmed current email even while a different email is pending", async () => {
  authUser({ email: "viewer@example.com", new_email: "pending@example.com", email_confirmed_at: "2026-10-03T00:00:00Z" });
  expect(await getCurrentUser()).toMatchObject({ emailVerified: true, pendingEmail: "pending@example.com" });
});

test("a missing profile cannot grant active-account actions", async () => {
  authUser({ email: "viewer@example.com", email_confirmed_at: "2026-10-03T00:00:00Z" }, null);
  expect(await getCurrentUser()).toMatchObject({ accountStatus: "INACTIVE" });
});

test("an authentication failure cannot return a usable current account", async () => {
  authUser({ email: "viewer@example.com", email_confirmed_at: "2026-10-03T00:00:00Z" }, { account_status: "ACTIVE" }, { code: "unavailable" });
  expect(await getCurrentUser()).toBeNull();
});
