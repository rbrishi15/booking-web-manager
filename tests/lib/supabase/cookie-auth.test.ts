import { AuthApiError, AuthSessionMissingError, type User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createLoginCookieIdentity } from "@/lib/supabase/cookie-auth";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const user = { id: "11111111-1111-4111-8111-111111111111", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-01T00:00:00Z" } as User;
const getUser = vi.fn();
const getSession = vi.fn();
const cookieStore = { getAll: vi.fn(() => [{ name: "sb-project-auth-token", value: "login" }]), set: vi.fn() };
const identify = createLoginCookieIdentity("https://supabase.example", "anon-key");

const get = () => new Request("https://app.example/api/wallet");

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user }, error: null });
  getSession.mockResolvedValue({ data: { session: { access_token: "fresh-token" } }, error: null });
  vi.mocked(cookies).mockResolvedValue(cookieStore as never);
  vi.mocked(createServerClient).mockReturnValue({ auth: { getUser, getSession } } as never);
});

describe("login cookie identity", () => {
  test("identifies a GET by the login cookies and returns the verified access token", async () => {
    // Act
    const identity = await identify(get());

    // Assert
    expect(identity).toEqual({ token: "fresh-token", userId: user.id, user });
    expect(createServerClient).toHaveBeenCalledWith("https://supabase.example", "anon-key", expect.anything());
    expect(getUser).toHaveBeenCalledExactlyOnceWith();
  });

  test("returns a refreshed login to the browser as cookies", async () => {
    // Arrange
    await identify(get());
    const { setAll } = vi.mocked(createServerClient).mock.calls[0]![2].cookies;

    // Act
    setAll!([{ name: "sb-project-auth-token", value: "refreshed", options: { path: "/", sameSite: "lax" } }], {});

    // Assert
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith("sb-project-auth-token", "refreshed", { path: "/", sameSite: "lax" });
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("never identifies a %s by cookies, so other sites cannot trigger changes", async (method) => {
    // Act & Assert
    expect(await identify(new Request("https://app.example/api/wallet/top-up", { method }))).toBeNull();
    expect(cookies).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  test.each([
    ["no login cookie", new AuthSessionMissingError()],
    ["an expired login that cannot be refreshed", new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found")],
    ["a rejected token", new AuthApiError("Invalid JWT", 401, undefined)],
  ])("treats %s as signed out", async (_name, error) => {
    // Arrange
    getUser.mockResolvedValueOnce({ data: { user: null }, error });

    // Act & Assert
    expect(await identify(get())).toBeNull();
  });

  test("propagates an auth provider outage instead of reporting the user signed out", async () => {
    // Arrange
    const outage = new AuthApiError("Provider unavailable", 503, undefined);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: outage });

    // Act & Assert
    await expect(identify(get())).rejects.toBe(outage);
  });
});
