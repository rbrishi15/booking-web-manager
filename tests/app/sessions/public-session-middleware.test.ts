import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { middleware } from "@/middleware";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    throw new Error("Public session endpoints must not initialize Supabase");
  }),
}));

describe("public session paths through authentication middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each(["/api/sessions", "/api/openapi", "/api-docs"])(
    "lets %s handle its request without contacting authentication",
    async (path) => {
      // Arrange
      const request = new NextRequest(`http://localhost${path}`);

      // Act
      const response = await middleware(request);

      // Assert
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(createServerClient).not.toHaveBeenCalled();
    },
  );

  test.each(["/groups", "/profile"])(
    "still checks authentication for protected page %s",
    async (path) => {
      // Arrange
      const request = new NextRequest(`http://localhost${path}`);

      // Act & Assert
      await expect(middleware(request)).rejects.toThrow(
        "Public session endpoints must not initialize Supabase",
      );
      expect(createServerClient).toHaveBeenCalledOnce();
    },
  );
});
