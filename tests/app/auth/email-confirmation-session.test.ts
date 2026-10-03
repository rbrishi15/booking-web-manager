import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "@/app/(auth)/auth/callback/route";
import { registerUser } from "@/app/(auth)/register/actions";
import { resendConfirmation } from "@/app/(auth)/resend-confirmation";
import { createClient } from "@/lib/supabase/server";
import { formDataOf } from "../../use-cases/support/fake-supabase-auth";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const origin = "https://booking-web-manager.vercel.app";
const jar = new Map<string, string>();
const user = {
  id: "9fdbf788-aa5c-4368-97df-cffdb6504501",
  email: "marcus@example.com",
  aud: "authenticated",
  role: "authenticated",
  created_at: "2026-10-02T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
  identities: [{ id: "identity", provider: "email" }],
};

beforeEach(() => {
  jar.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://confirmation-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.mocked(headers).mockResolvedValue(new Headers({ origin }) as never);
  vi.mocked(cookies).mockResolvedValue({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number }) => {
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test.each(["signup", "resend"])("UC1-01 %s completes the real SSR PKCE flow and saves a usable login cookie", async (flow) => {
  let challenge = "";
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === `/auth/v1/${flow}`) {
      expect(url.searchParams.get("redirect_to")).toBe(`${origin}/auth/callback`);
      const body = JSON.parse(String(init?.body));
      expect(body.code_challenge_method).toBe("s256");
      challenge = body.code_challenge;
      return Response.json(flow === "signup" ? user : {});
    }
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init?.body));
      expect(body.auth_code).toBe("email-code");
      expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(challenge);
      expect(url.searchParams.get("grant_type")).toBe("pkce");
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const token = [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
        Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt })).toString("base64url"),
        "test-signature",
      ].join(".");
      return Response.json({ access_token: token, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user: { ...user, email_confirmed_at: "2026-10-03T00:00:00Z" } });
    }
    if (url.pathname === "/auth/v1/user") return Response.json({ ...user, email_confirmed_at: "2026-10-03T00:00:00Z" });
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);

  const state = flow === "signup"
    ? await registerUser({ status: "idle" }, formDataOf({
      displayName: "Marcus Lim", email: user.email, password: "password123", region: "West", sport: "Tennis",
    }))
    : await resendConfirmation({ status: "idle" }, formDataOf({ email: user.email }));

  expect(state.status).toBe(flow === "signup" ? "check-email" : "sent");
  expect([...jar.keys()].some((name) => name.includes("code-verifier"))).toBe(true);

  const response = await GET(new NextRequest(`${origin}/auth/callback?code=email-code`));

  expect(response.headers.get("location")).toBe("/");
  expect(jar.has("sb-confirmation-test-auth-token")).toBe(true);
  const subsequentRequestClient = await createClient();
  const currentUser = await subsequentRequestClient.auth.getUser();
  expect(currentUser.data.user?.id).toBe(user.id);
  expect(currentUser.error).toBeNull();
});
