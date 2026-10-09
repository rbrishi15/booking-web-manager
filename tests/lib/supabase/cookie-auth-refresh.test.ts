import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cookies } from "next/headers";
import { createSupabaseCookieIdentityAuthenticator } from "@/lib/supabase/cookie-auth";

// Real @supabase/ssr and lib/supabase/server.ts against a local stand-in for Supabase Auth
// that rotates refresh tokens like the real service: a used refresh token is accepted again
// only within a short reuse interval (Supabase's default is 10 seconds).
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
const reuseIntervalMs = 10_000;
let validAccessTokens = new Set<string>();
let refreshTokens = new Map<string, { usedAt: number | null }>();
let refreshCalls = 0;
let issued = 0;
let url = "";

function issue() {
  issued += 1;
  const access = `access-${issued}`;
  const refresh = `refresh-${issued}`;
  validAccessTokens.add(access);
  refreshTokens.set(refresh, { usedAt: null });
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user };
}

function reply(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url?.startsWith("/auth/v1/user")) {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    return validAccessTokens.has(token) ? reply(res, 200, user) : reply(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  }
  if (req.url?.startsWith("/auth/v1/token")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      refreshCalls += 1;
      const token = refreshTokens.get(JSON.parse(body).refresh_token as string);
      const now = Date.now();
      if (token === undefined || (token.usedAt !== null && now - token.usedAt > reuseIntervalMs)) {
        return reply(res, 400, { code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" });
      }
      token.usedAt ??= now;
      reply(res, 200, issue());
    });
    return;
  }
  reply(res, 404, {});
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  validAccessTokens = new Set();
  refreshTokens = new Map();
  refreshCalls = 0;
});

const cookieName = "sb-127-auth-token";

/** The login cookie @supabase/ssr writes, for a session whose access token has already expired. */
function expiredLoginCookie() {
  const session = issue();
  validAccessTokens.delete(session.access_token);
  return `base64-${Buffer.from(JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}`;
}

/** One request's cookie store, as next/headers provides it to a route handler. */
function requestCookies(value: string | null) {
  const jar = new Map<string, string>();
  if (value !== null) jar.set(cookieName, value);
  const set = vi.fn((name: string, cookie: string) => { jar.set(name, cookie); });
  return { store: { getAll: () => [...jar].map(([name, cookie]) => ({ name, value: cookie })), set }, jar, set };
}

function decode(cookie: string | undefined): { refresh_token?: string } {
  return cookie?.startsWith("base64-") ? JSON.parse(Buffer.from(cookie.slice(7), "base64url").toString()) : {};
}

const get = () => new Request("http://app.test/api/wallet");

describe("login cookies with an expired access token", () => {
  test("two simultaneous requests both refresh the login and stay signed in", async () => {
    // Arrange: the summary and transactions queries start together with the same expired cookie.
    const cookie = expiredLoginCookie();
    const summary = requestCookies(cookie);
    const transactions = requestCookies(cookie);
    vi.mocked(cookies).mockResolvedValueOnce(summary.store as never).mockResolvedValueOnce(transactions.store as never);
    const authenticate = createSupabaseCookieIdentityAuthenticator(url, "anon-key");

    // Act
    const results = await Promise.all([authenticate(get()), authenticate(get())]);

    // Assert
    expect(results).toEqual([user.id, user.id]);
    expect(refreshCalls).toBe(2);
    // Each response carries a refreshed login cookie back to the browser.
    expect(summary.set).toHaveBeenCalled();
    expect(transactions.set).toHaveBeenCalled();
    const latest = decode(transactions.jar.get(cookieName));
    expect(latest.refresh_token).toMatch(/^refresh-/);

    // The browser keeps whichever refreshed cookie arrived last; the next request still works.
    vi.mocked(cookies).mockResolvedValueOnce(requestCookies(transactions.jar.get(cookieName)!).store as never);
    expect(await authenticate(get())).toBe(user.id);
  });

  test("a refresh token reused after the reuse interval signs the user out instead of failing the request", async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const cookie = expiredLoginCookie();
      vi.mocked(cookies).mockResolvedValueOnce(requestCookies(cookie).store as never);
      const authenticate = createSupabaseCookieIdentityAuthenticator(url, "anon-key");
      expect(await authenticate(get())).toBe(user.id);
      vi.setSystemTime(Date.now() + reuseIntervalMs + 1_000);

      // Act
      vi.mocked(cookies).mockResolvedValueOnce(requestCookies(cookie).store as never);

      // Assert
      expect(await authenticate(get())).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a missing or unreadable login cookie is signed out without calling Supabase Auth", async () => {
    // Arrange
    const authenticate = createSupabaseCookieIdentityAuthenticator(url, "anon-key");
    vi.mocked(cookies).mockResolvedValueOnce(requestCookies(null).store as never).mockResolvedValueOnce(requestCookies("base64-not-json").store as never);

    // Act & Assert
    expect(await authenticate(get())).toBeNull();
    expect(await authenticate(get())).toBeNull();
    expect(refreshCalls).toBe(0);
  });
});
