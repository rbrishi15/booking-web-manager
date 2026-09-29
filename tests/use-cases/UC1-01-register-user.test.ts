import { describe, expect, test } from "vitest";
import { passwordStrength } from "@/app/(auth)/register/password-strength";
import { registerSchema } from "@/app/(auth)/schemas";

// Owner: Joseph (Jolingoes) — /app/(auth)
describe("UC1-01 Register User", () => {
  test.todo("registers a new user with a unique email");
  test.todo("rejects registration with an email already in use");

  describe("rejects invalid or weak credentials at the boundary (Zod)", () => {
    test("rejects an invalid email", () => {
      // Arrange
      const input = validRegistration({ email: "not-an-email" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.email).toEqual(["Enter a valid email address"]);
    });

    test("rejects a password shorter than 8 characters", () => {
      // Arrange
      const input = validRegistration({ password: "short" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.password).toEqual(["Use at least 8 characters"]);
    });

    test("rejects a blank name", () => {
      // Arrange
      const input = validRegistration({ displayName: "   " });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.displayName).toEqual(["Enter your name"]);
    });

    test("rejects a region that is not in the list", () => {
      // Arrange
      const input = validRegistration({ region: "Mars" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.region).toEqual(["Choose a region"]);
    });
  });

  test("accepts valid details and normalises the name and email", () => {
    // Arrange
    const input = validRegistration({ displayName: "  Marcus Lim  ", email: "  Marcus@Example.com " });

    // Act
    const result = registerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.displayName).toBe("Marcus Lim");
    expect(result.data?.email).toBe("marcus@example.com");
  });

  describe("password strength hint", () => {
    test.each([
      ["", 0],
      ["short", 1],
      ["password", 1],
      ["password1", 2],
      ["Password1", 3],
      ["Password1!", 4],
    ] as const)("scores %j as %i bars", (password, expectedScore) => {
      // Act
      const result = passwordStrength(password);

      // Assert
      expect(result.score).toBe(expectedScore);
    });
  });
});

function validRegistration(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Marcus Lim",
    email: "marcus@example.com",
    password: "password123",
    region: "West",
    sport: "Tennis",
    ...overrides,
  };
}
