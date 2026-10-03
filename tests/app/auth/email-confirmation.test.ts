import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { emailConfirmationRedirectTo } from "@/app/(auth)/email-confirmation-url";
import { GET } from "@/app/(auth)/auth/callback/route";
import { createClient } from "@/lib/supabase/server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const origin = "https://booking-web-manager.vercel.app";
const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(headers).mockResolvedValue(new Headers({ origin }) as never);
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { exchangeCodeForSession, getUser } } as never);
});

describe("UC1-01 email confirmation return URL", () => {
  test.each([origin, "http://localhost:3000", "http://127.0.0.1:3000"])("returns to the registering site %s", async (site) => {
    vi.mocked(headers).mockResolvedValue(new Headers({ origin: site }) as never);
    expect(await emailConfirmationRedirectTo()).toBe(`${site}/auth/callback`);
  });

  test.each([null, "null", "not a URL", "ftp://example.com", "http://example.com", "https://user:pass@example.com", "https://example.com/path"])("refuses a missing or invalid origin %s", async (site) => {
    vi.mocked(headers).mockResolvedValue(new Headers(site === null ? {} : { origin: site }) as never);
    expect(await emailConfirmationRedirectTo()).toBeNull();
  });
});

describe("UC1-01 email confirmation callback", () => {
  test("exchanges the confirmation code for a cookie session and returns home without the code", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: { id: "user" } }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: "user", email: "viewer@example.com", email_confirmed_at: "2026-10-03T00:00:00Z" } }, error: null });

    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code&next=https://elsewhere.example`));

    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("email-code");
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test.each(["", "?error=access_denied&error_description=untrusted", "?code="])("shows a recoverable login message for invalid callback %s", async (query) => {
    const response = await GET(new NextRequest(`${origin}/auth/callback${query}`));

    expect(response.headers.get("location")).toBe("/login?verification=failed");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test("handles an expired code or a link opened in a different browser", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: { code: "bad_code_verifier" } });

    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code`));

    expect(response.headers.get("location")).toBe("/login?verification=failed");
    expect(response.headers.get("location")).not.toContain("email-code");
  });

  test("keeps an existing session usable and shows signed-in recovery after an expired link", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "viewer@example.com" } }, error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: { code: "bad_code_verifier" } });
    const response = await GET(new NextRequest(`${origin}/auth/callback?code=expired`));
    expect(response.headers.get("location")).toBe("/profile/email?verification=failed");
    expect(response.headers.get("location")).not.toContain("expired");
  });

  test("keeps recovery on the browser origin when the server sees an internal callback URL", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "viewer@example.com" } }, error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: { code: "bad_code_verifier" } });
    const response = await GET(new NextRequest("http://localhost:3100/auth/callback?code=expired", {
      headers: { host: "127.0.0.1:3100", "x-forwarded-host": "elsewhere.example" },
    }));
    const destination = response.headers.get("location");
    expect(destination).toBe("/profile/email?verification=failed");
    expect(new URL(destination!, "http://127.0.0.1:3100/auth/callback").origin).toBe("http://127.0.0.1:3100");
    expect(response.status).toBe(307);
  });

  test("does not treat exchanging a code as proof that the current email is confirmed", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "viewer@example.com" } }, error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: { id: "viewer" } }, error: null });
    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code`));
    expect(response.headers.get("location")).toBe("/profile/email?verification=pending");
    expect(getUser).toHaveBeenCalledExactlyOnceWith();
  });

  test("shows app-owned pending guidance when one secure email-change link remains", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "viewer@example.com", new_email: "pending@example.com" } }, error: null });
    const response = await GET(new NextRequest(`${origin}/auth/callback?message=untrusted-provider-text`));
    expect(response.headers.get("location")).toBe("/profile/email?verification=pending");
    expect(response.headers.get("location")).not.toContain("untrusted-provider-text");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test("still checks an existing session when the exchange throws", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "viewer@example.com" } }, error: null });
    exchangeCodeForSession.mockRejectedValue(new Error("private auth detail"));
    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code`));
    expect(response.headers.get("location")).toBe("/profile/email?verification=failed");
    expect(getUser).toHaveBeenCalledExactlyOnceWith();
  });
});
