import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { middleware } from "@/middleware";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";

vi.mock("@/lib/supabase/is-configured", () => ({ isAuthenticationConfigured: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    throw new Error("Public session endpoints must not initialize Supabase");
  }),
}));

describe("public session paths through authentication middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAuthenticationConfigured).mockReturnValue(true);
  });

  test.each([
    "/api/sessions", "/api/openapi", "/api-docs", "/storybook", "/storybook/index.html?path=/story/discovery--populated",
    "/storybook/iframe.html", "/storybook/index.json", "/storybook/assets/manager.js", "/storybook/assets/style.css", "/fonts/inter-v20-latin.woff2",
  ])(
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

  test.each(["/groups", "/profile", "/storybook-private", "/storybooks", "/fonts-private/inter.woff2"])(
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

  test("serves the anonymous root without configured authentication", async () => {
    vi.mocked(isAuthenticationConfigured).mockReturnValue(false);
    const response = await middleware(new NextRequest("http://localhost/?sport=Tennis"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  test("checks configured root identity so Home can be rendered for an active account", async () => {
    await expect(middleware(new NextRequest("http://localhost/"))).rejects.toThrow("Public session endpoints must not initialize Supabase");
    expect(createServerClient).toHaveBeenCalledOnce();
  });
});
