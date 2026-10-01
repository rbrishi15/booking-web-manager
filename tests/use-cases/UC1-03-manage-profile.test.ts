import { describe, expect, test } from "vitest";
import { profileSchema } from "@/app/profile/schemas";

/** A valid Edit profile submission; pass only the fields a test changes. */
function validProfile(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Marcus Lim",
    preferredSports: ["Badminton", "Tennis"],
    preferredRegions: ["West"],
    ...overrides,
  };
}

// Owner: Joseph (Jolingoes) — /app/profile
describe("UC1-03 Manage Profile", () => {
  test.todo("updates editable profile fields");
  test.todo("computes and displays the reliability score");

  describe("checks the Edit profile form at the boundary (Zod)", () => {
    test("accepts several sports and regions (REQ-3, REQ-4)", () => {
      // Arrange
      const input = validProfile({ preferredRegions: ["West", "Central"] });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data?.preferredSports).toEqual(["Badminton", "Tennis"]);
      expect(result.data?.preferredRegions).toEqual(["West", "Central"]);
    });

    test("trims the name", () => {
      // Arrange
      const input = validProfile({ displayName: "  Marcus Lim  " });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.data?.displayName).toBe("Marcus Lim");
    });

    test("removes repeated picks", () => {
      // Arrange
      const input = validProfile({ preferredSports: ["Tennis", "Tennis"] });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.data?.preferredSports).toEqual(["Tennis"]);
    });

    test.each([
      ["displayName", { displayName: "   " }, "Enter your name"],
      ["displayName", { displayName: "x".repeat(61) }, "Keep your name under 60 characters"],
      ["preferredSports", { preferredSports: [] }, "Choose at least one sport"],
      ["preferredRegions", { preferredRegions: [] }, "Choose at least one region"],
      ["preferredSports", { preferredSports: ["Chess"] }, "Choose sports from the list"],
      ["preferredRegions", { preferredRegions: ["Johor"] }, "Choose regions from the list"],
    ] as const)("rejects a bad %s", (field, overrides, message) => {
      // Arrange
      const input = validProfile(overrides);

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors[field]).toEqual([message]);
    });
  });
});
