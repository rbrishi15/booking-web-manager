import { createBearerAuthenticator } from "@/lib/supabase/bearer-auth";
import {
  createBearerAccountStatusReader,
  createSupabaseAuthClient,
} from "@/lib/supabase/bearer-client";
import { afterEach, describe, expect, test, vi } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session API bearer authentication", () => {
  test.each([null, "", "Basic token", "Bearer", "Bearer one two", "Bearer one,two"])(
    "rejects missing or malformed authorization %s without a provider call",
    async (authorization) => {
      const { authenticate, fetch } = authenticationScenario();

      expect(await authenticate(request(authorization))).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("verifies the bearer token and reads the verified profile through its bearer identity", async () => {
    const { authenticate, fetch } = authenticationScenario();

    const identity = await authenticate(request("bEaReR access-token"));

    expect(identity).toBe(userId);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://supabase.example.test/auth/v1/user");
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer access-token");
    const [profileUrl, profileOptions] = fetch.mock.calls[1]!;
    const profile = new URL(String(profileUrl));
    expect(profile.pathname).toBe("/rest/v1/profiles");
    expect(profile.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(profile.searchParams.get("select")).toBe("account_status");
    expect(new Headers(profileOptions?.headers).get("Authorization")).toBe("Bearer access-token");
  });

  test.each([400, 401, 403])("treats rejected or expired tokens (%s) as unauthenticated", async (status) => {
    const { authenticate, fetch } = authenticationScenario({
      authStatus: status,
      authBody: { code: "bad_jwt", msg: "Expired or invalid token" },
    });

    expect(await authenticate(request("Bearer expired-token"))).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("propagates provider outages so the HTTP module returns an opaque server error", async () => {
    const { authenticate } = authenticationScenario({
      authStatus: 503,
      authBody: { msg: "private-auth-provider-failure" },
    });

    await expect(authenticate(request("Bearer access-token"))).rejects.toBeDefined();
  });

  test.each(["INACTIVE", "unknown-status"])(
    "denies an account whose current status is %s despite a valid token",
    async (accountStatus) => {
      const { authenticate } = authenticationScenario({
        profileBody: [{ account_status: accountStatus }],
      });

      await expect(authenticate(request("Bearer access-token"))).rejects.toMatchObject({
        code: "INACTIVE_ACCOUNT",
      });
    },
  );

  test("preserves a missing domain account as not found", async () => {
    const { authenticate } = authenticationScenario({ profileBody: [] });

    await expect(authenticate(request("Bearer access-token"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("fails closed when the profile provider fails", async () => {
    vi.useFakeTimers();
    const { authenticate } = authenticationScenario({
      profileStatus: 503,
      profileBody: { code: "provider-unavailable", message: "private-profile-provider-failure" },
    });

    const assertion = expect(authenticate(request("Bearer access-token"))).rejects.toThrow(
      "Account status could not be checked",
    );
    await vi.runAllTimersAsync();
    await assertion;
  });

  test("keeps simultaneous profile lookups scoped to each request's bearer token", async () => {
    const { authenticate, fetch } = authenticationScenario();

    await Promise.all([
      authenticate(request("Bearer first-token")),
      authenticate(request("Bearer second-token")),
    ]);

    const profileHeaders = fetch.mock.calls
      .filter(([url]) => new URL(String(url)).pathname === "/rest/v1/profiles")
      .map(([, options]) => new Headers(options?.headers).get("Authorization"));
    expect(profileHeaders.sort()).toEqual(["Bearer first-token", "Bearer second-token"]);
  });
});

function request(authorization: string | null): Request {
  const headers = new Headers();
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("https://example.test/api/sessions", { headers });
}

function authenticationScenario(options: {
  authStatus?: number;
  authBody?: unknown;
  profileStatus?: number;
  profileBody?: unknown;
} = {}) {
  const authBody = options.authBody ?? {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "booker@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
    const isProfile = new URL(String(url)).pathname === "/rest/v1/profiles";
    return new Response(JSON.stringify(isProfile
      ? (options.profileBody ?? [{ account_status: "ACTIVE" }])
      : authBody), {
      status: isProfile ? (options.profileStatus ?? 200) : (options.authStatus ?? 200),
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const url = "https://supabase.example.test";
  const anonKey = "public-anon-key";
  const client = createSupabaseAuthClient(url, anonKey);
  return {
    authenticate: createBearerAuthenticator(client.auth, createBearerAccountStatusReader(url, anonKey)),
    fetch,
  };
}
