import {
  AuthApiError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";
import { createBearerAuthenticator } from "@/lib/supabase/bearer-auth";
import type { AccountStatus } from "@/lib/supabase/account-status";

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
