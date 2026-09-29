import { describe, expect, test } from "vitest";
import { HOME_PATH, safeRedirectPath } from "@/app/(auth)/redirect-path";
import { loginSchema } from "@/app/(auth)/schemas";

// Owner: Joseph (Jolingoes) — /app/(auth)
describe("UC1-02 Authenticate User", () => {
  test.todo("logs in with valid credentials");
  test.todo("rejects invalid credentials without revealing which field was wrong");
  test.todo("establishes a session that subsequent requests can use");

  test("rejects an empty password before contacting Supabase", () => {
    // Arrange
    const input = { email: "marcus@example.com", password: "" };

    // Act
    const result = loginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.password).toEqual(["Enter your password"]);
  });

  test("accepts a valid email and password", () => {
    // Arrange
    const input = { email: "marcus@example.com", password: "anything" };

    // Act
    const result = loginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  describe("redirect after log-in", () => {
    test.each([
      ["/profile", "/profile"],
      ["/groups/join/abc123", "/groups/join/abc123"],
    ] as const)("returns to %s", (next, expected) => {
      // Act
      const result = safeRedirectPath(next);

      // Assert
      expect(result).toBe(expected);
    });

    test.each([
      [undefined],
      [""],
      ["https://evil.example"],
      ["//evil.example"],
      ["/\\evil.example"],
      ["/login"],
      ["/register"],
    ] as const)("sends %j to Home instead", (next) => {
      // Act
      const result = safeRedirectPath(next);

      // Assert
      expect(result).toBe(HOME_PATH);
    });
  });
});