import { AuthApiError, AuthSessionMissingError, type User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { createSupabaseCookieIdentityAuthenticator, createSupabaseCookieSessionAuthenticator } from "@/lib/supabase/cookie-auth";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/account-status", () => ({ getAccountStatus: vi.fn() }));

const user = { id: "11111111-1111-4111-8111-111111111111", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-01T00:00:00Z" } as User;
const getUser = vi.fn();
const cookieClient = { auth: { getUser } };
const identity = createSupabaseCookieIdentityAuthenticator("https://supabase.example", "anon-key");
const session = createSupabaseCookieSessionAuthenticator("https://supabase.example", "anon-key");

const get = () => new Request("https://app.example/api/wallet");

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user }, error: null });
  vi.mocked(createClient).mockResolvedValue(cookieClient as never);
  vi.mocked(getAccountStatus).mockResolvedValue({ kind: "active" });
});

describe("login cookie authentication", () => {
  test("identifies a GET with the shared server client for the configured project", async () => {
    // Act & Assert
    expect(await identity(get())).toBe(user.id);
    expect(createClient).toHaveBeenCalledExactlyOnceWith("https://supabase.example", "anon-key");
    expect(getUser).toHaveBeenCalledExactlyOnceWith();
    expect(getAccountStatus).not.toHaveBeenCalled();
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("never identifies a %s by cookies, so other sites cannot trigger changes", async (method) => {
    // Act & Assert
    expect(await identity(new Request("https://app.example/api/wallet/top-up", { method }))).toBeNull();
    expect(await session(new Request("https://app.example/api/wallet/top-up", { method }))).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  test.each([
    ["no login cookie", new AuthSessionMissingError()],
    ["an expired login that cannot be refreshed", new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found")],
    ["a rejected token", new AuthApiError("Invalid JWT", 401, undefined)],
  ])("treats %s as signed out", async (_name, error) => {
    // Arrange
    getUser.mockResolvedValue({ data: { user: null }, error });

    // Act & Assert
    expect(await identity(get())).toBeNull();
    expect(await session(get())).toBeNull();
    expect(getAccountStatus).not.toHaveBeenCalled();
  });

  test("propagates an auth provider outage instead of reporting the user signed out", async () => {
    // Arrange
    const outage = new AuthApiError("Provider unavailable", 503, undefined);
    getUser.mockResolvedValue({ data: { user: null }, error: outage });

    // Act & Assert
    await expect(identity(get())).rejects.toBe(outage);
    await expect(session(get())).rejects.toBe(outage);
  });

  test("applies the same account checks as bearer authentication, read with the cookie client", async () => {
    // Act & Assert
    expect(await session(get())).toBe(user.id);
    expect(getAccountStatus).toHaveBeenCalledExactlyOnceWith(cookieClient, user.id);
    vi.mocked(getAccountStatus).mockResolvedValueOnce({ kind: "inactive" });
    await expect(session(get())).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    vi.mocked(getAccountStatus).mockResolvedValueOnce({ kind: "missing-profile" });
    await expect(session(get())).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(getAccountStatus).mockResolvedValueOnce({ kind: "lookup-failed", code: "PGRST000", message: "Offline" });
    await expect(session(get())).rejects.toThrow("Account status could not be checked");
  });
});
