import { beforeEach, describe, expect, test, vi } from "vitest";
import { logIn } from "@/app/(auth)/login/actions";
import { registerUser } from "@/app/(auth)/register/actions";
import { createClient } from "@/lib/supabase/server";
import { fakeSupabase, formDataOf } from "../../use-cases/support/fake-supabase-auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://booking-web-manager.vercel.app" }),
}));

beforeEach(() => vi.clearAllMocks());

describe("UC1-01/UC1-02 pending email verification", () => {
  test.each([
    ["/sessions/11111111-1111-4111-8111-111111111111/join?token=room-token", "/sessions/11111111-1111-4111-8111-111111111111/join?token=room-token"],
    ["https://elsewhere.example/steal", "/"], ["//elsewhere.example", "/"], ["/\\elsewhere.example", "/"],
    ["/login?next=/profile", "/"], ["/auth/callback?code=untrusted", "/"],
  ])("immediate registration returns safely from %s", async (next, destination) => {
    const supabase = fakeSupabase({ signUp: { data: { user: { id: "new-user", identities: [{}] }, session: {} }, error: null } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    await expect(registerUser({ status: "idle" }, formDataOf({
      displayName: "Marcus", email: "marcus@example.com", password: "password123", region: "West", sport: "Tennis", handle: "marcus_lim", next,
    }))).rejects.toThrow(`redirect:${destination}`);
    const redirectTo = new URL("https://booking-web-manager.vercel.app/auth/callback");
    if (destination !== "/") redirectTo.searchParams.set("next", destination);
    expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ emailRedirectTo: redirectTo.href }),
    }));
  });
  test("keeps registration signed out and retains the email for a replacement confirmation link", async () => {
    const supabase = fakeSupabase({
      signUp: { data: { user: { id: "pending-user", identities: [{}] }, session: null }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await registerUser({ status: "idle" }, formDataOf({
      displayName: "Marcus", email: " Marcus@Example.com ", password: "password123", region: "West", sport: "Tennis", handle: "marcus_lim",
    }));

    expect(result).toMatchObject({ status: "check-email", email: "marcus@example.com" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("gives an unverified login the same recoverable state without loading protected account data", async () => {
    const supabase = fakeSupabase({
      signIn: {
        data: { user: null, session: null },
        error: { code: "email_not_confirmed", message: "Email not confirmed" },
      },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const result = await logIn({ status: "idle" }, formDataOf({
      email: " Marcus@Example.com ", password: "password123", next: "/profile",
    }));

    expect(result).toMatchObject({ status: "check-email", email: "marcus@example.com" });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
