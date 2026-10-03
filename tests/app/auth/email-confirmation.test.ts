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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(headers).mockResolvedValue(new Headers({ origin }) as never);
  vi.mocked(createClient).mockResolvedValue({ auth: { exchangeCodeForSession } } as never);
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

    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code&next=https://elsewhere.example`));

    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("email-code");
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test.each(["", "?error=access_denied&error_description=untrusted", "?code="])("shows a recoverable login message for invalid callback %s", async (query) => {
    const response = await GET(new NextRequest(`${origin}/auth/callback${query}`));

    expect(response.headers.get("location")).toBe(`${origin}/login?verification=failed`);
    expect(createClient).not.toHaveBeenCalled();
  });

  test("handles an expired code or a link opened in a different browser", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: { code: "bad_code_verifier" } });

    const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code`));

    expect(response.headers.get("location")).toBe(`${origin}/login?verification=failed`);
    expect(response.headers.get("location")).not.toContain("email-code");
  });
});
