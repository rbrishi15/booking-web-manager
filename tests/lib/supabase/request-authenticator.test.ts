import { describe, expect, test, vi } from "vitest";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";

const userId = "11111111-1111-4111-8111-111111111111";

describe("choosing the authentication policy", () => {
  test("uses only the bearer policy when an Authorization header is sent, even if it rejects", async () => {
    // Arrange
    const bearer = vi.fn(async () => null);
    const loginCookie = vi.fn(async () => userId);
    const authenticate = bearerOrLoginCookie(bearer, loginCookie);

    // Act & Assert
    for (const authorization of ["Bearer rejected", "Bearer", "Basic token"]) {
      expect(await authenticate(new Request("https://app.example/api/wallet", { headers: { authorization } }))).toBeNull();
    }
    expect(bearer).toHaveBeenCalledTimes(3);
    expect(loginCookie).not.toHaveBeenCalled();
  });

  test("uses only the login-cookie policy when no Authorization header is sent", async () => {
    // Arrange
    const bearer = vi.fn(async () => userId);
    const loginCookie = vi.fn(async () => userId);

    // Act & Assert
    expect(await bearerOrLoginCookie(bearer, loginCookie)(new Request("https://app.example/api/wallet"))).toBe(userId);
    expect(bearer).not.toHaveBeenCalled();
    expect(loginCookie).toHaveBeenCalledOnce();
  });
});
