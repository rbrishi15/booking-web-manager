import {
  AuthApiError,
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { createBearerAuthenticator, createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import type { AccountStatus } from "@/lib/supabase/account-status";

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(),
  createClient: vi.fn(),
}));

const identity: User = {
  id: "11111111-1111-4111-8111-111111111111",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-10-01T00:00:00Z",
};

function scenario() {
  const getUser = vi
    .fn<SupabaseClient["auth"]["getUser"]>()
    .mockResolvedValue({ data: { user: identity }, error: null });
  const status = vi
    .fn<(token: string, userId: string) => Promise<AccountStatus>>()
    .mockResolvedValue({ kind: "active" });
  return {
    getUser,
    status,
    authenticate: createBearerAuthenticator({ getUser }, status),
  };
}

function request(authorization?: string) {
  return new Request("https://example.test/api/sessions", {
    headers: authorization ? { authorization } : {},
  });
}

describe("session bearer authentication", () => {
  test.each([
    undefined,
    "Basic token",
    "Bearer",
    "Bearer one two",
    "Bearer one,two",
  ])(
    "rejects malformed credentials %s without network calls",
    async (header) => {
      const setup = scenario();
      expect(await setup.authenticate(request(header))).toBeNull();
      expect(setup.getUser).not.toHaveBeenCalled();
      expect(setup.status).not.toHaveBeenCalled();
    },
  );

  test("verifies identity and checks current access on every request", async () => {
    const setup = scenario();
    expect(await setup.authenticate(request("bearer\tfirst-token"))).toBe(
      identity.id,
    );
    setup.status.mockResolvedValueOnce({ kind: "inactive" });
    await expect(
      setup.authenticate(request("Bearer second-token")),
    ).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(setup.getUser.mock.calls).toEqual([
      ["first-token"],
      ["second-token"],
    ]);
    expect(setup.status.mock.calls).toEqual([
      ["first-token", identity.id],
      ["second-token", identity.id],
    ]);
  });

  test.each([400, 401, 403])(
    "maps rejected bearer status %s to unauthenticated",
    async (code) => {
      const setup = scenario();
      setup.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: new AuthApiError("Rejected", code, undefined),
      });
      expect(await setup.authenticate(request("Bearer rejected"))).toBeNull();
      expect(setup.status).not.toHaveBeenCalled();
    },
  );

  test("propagates auth provider outages", async () => {
    const setup = scenario();
    const outage = new AuthApiError("Provider unavailable", 503, undefined);
    setup.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: outage,
    });
    await expect(setup.authenticate(request("Bearer token"))).rejects.toBe(
      outage,
    );
    expect(setup.status).not.toHaveBeenCalled();
  });

  test("reports a missing profile separately from a failed lookup", async () => {
    const setup = scenario();
    setup.status.mockResolvedValueOnce({ kind: "missing-profile" });
    await expect(
      setup.authenticate(request("Bearer token")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    setup.status.mockResolvedValueOnce({
      kind: "lookup-failed",
      code: "PGRST000",
      message: "Offline",
    });
    await expect(setup.authenticate(request("Bearer token"))).rejects.toThrow(
      "Account status could not be checked",
    );
  });
});

describe("discovery identity authentication", () => {
  function identityScenario() {
    const getUser = vi.fn<SupabaseClient["auth"]["getUser"]>()
      .mockResolvedValue({ data: { user: identity }, error: null });
    const from = vi.fn();
    vi.mocked(createClient).mockReset().mockReturnValue({ auth: { getUser }, from } as never);
    return {
      getUser,
      from,
      authenticate: createSupabaseIdentityAuthenticator("https://supabase.example", "anon-key"),
    };
  }

  test("verifies each bearer identity without reading account status", async () => {
    const setup = identityScenario();
    expect(await setup.authenticate(request("bearer\tfirst-token"))).toBe(identity.id);
    expect(await setup.authenticate(request("Bearer second-token"))).toBe(identity.id);
    expect(setup.getUser.mock.calls).toEqual([["first-token"], ["second-token"]]);
    expect(setup.from).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledExactlyOnceWith("https://supabase.example", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  test.each([undefined, "Basic token", "Bearer", "Bearer one two", "Bearer one,two"])(
    "rejects malformed credentials %s before verification",
    async (header) => {
      const setup = identityScenario();
      expect(await setup.authenticate(request(header))).toBeNull();
      expect(setup.getUser).not.toHaveBeenCalled();
      expect(setup.from).not.toHaveBeenCalled();
    },
  );

  test.each([400, 401, 403])("maps rejected bearer status %s to unauthenticated", async (code) => {
    const setup = identityScenario();
    setup.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Rejected", code, undefined) });
    expect(await setup.authenticate(request("Bearer rejected"))).toBeNull();
    expect(setup.from).not.toHaveBeenCalled();
  });

  test("propagates provider outages without reading account status", async () => {
    const setup = identityScenario();
    const outage = new AuthApiError("Provider unavailable", 503, undefined);
    setup.getUser.mockResolvedValue({ data: { user: null }, error: outage });
    await expect(setup.authenticate(request("Bearer token"))).rejects.toBe(outage);
    expect(setup.from).not.toHaveBeenCalled();
  });
});


describe("verified email required for session entry", () => {
  test.each([
    { email: undefined, email_confirmed_at: undefined },
    { email: "", email_confirmed_at: "2026-10-01T00:00:00Z" },
    { email: "player@example.com", email_confirmed_at: undefined },
  ])("rejects missing or unconfirmed email before creation or replay: %j", async (email) => {
    const setup = scenario();
    setup.getUser.mockResolvedValue({ data: { user: { ...identity, ...email } }, error: null });
    const authenticate = createBearerAuthenticator({ getUser: setup.getUser }, setup.status, { requireVerifiedEmail: true });
    await expect(authenticate(request("Bearer token"))).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });

  test("rechecks confirmation when the same request is retried", async () => {
    const setup = scenario();
    setup.getUser.mockResolvedValue({ data: { user: { ...identity, email: "player@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" } }, error: null });
    const authenticate = createBearerAuthenticator({ getUser: setup.getUser }, setup.status, { requireVerifiedEmail: true });
    expect(await authenticate(request("Bearer token"))).toBe(identity.id);
    setup.getUser.mockResolvedValue({ data: { user: { ...identity, email: "player@example.com" } }, error: null });
    await expect(authenticate(request("Bearer token"))).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    expect(setup.getUser).toHaveBeenCalledTimes(2);
  });
});

describe("identity without a bearer token", () => {
  function fallbackScenario() {
    const setup = scenario();
    const withoutBearer = vi.fn<(request: Request) => Promise<{ token: string; userId: string; user: User } | null>>()
      .mockResolvedValue({ token: "cookie-token", userId: identity.id, user: identity });
    return { ...setup, withoutBearer, authenticate: createBearerAuthenticator({ getUser: setup.getUser }, setup.status, { withoutBearer }) };
  }

  test("identifies a request with no Authorization header through the fallback, with the same account checks", async () => {
    const setup = fallbackScenario();
    expect(await setup.authenticate(request())).toBe(identity.id);
    expect(setup.getUser).not.toHaveBeenCalled();
    expect(setup.status).toHaveBeenCalledExactlyOnceWith("cookie-token", identity.id);
    setup.status.mockResolvedValueOnce({ kind: "inactive" });
    await expect(setup.authenticate(request())).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
  });

  test("returns unauthenticated when the fallback finds no login", async () => {
    const setup = fallbackScenario();
    setup.withoutBearer.mockResolvedValueOnce(null);
    expect(await setup.authenticate(request())).toBeNull();
    expect(setup.status).not.toHaveBeenCalled();
  });

  test.each(["Bearer rejected", "Bearer", "Basic token"])("never falls back when an Authorization header is sent (%s)", async (header) => {
    const setup = fallbackScenario();
    setup.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Rejected", 401, undefined) });
    expect(await setup.authenticate(request(header))).toBeNull();
    expect(setup.withoutBearer).not.toHaveBeenCalled();
  });
});
