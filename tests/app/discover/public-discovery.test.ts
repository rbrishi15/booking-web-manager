import { beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({ createDiscoveryDependencies: vi.fn() }));
vi.mock("@/use-case-config/discovery", () => configuration);

describe("public session discovery", () => {
  beforeEach(() => { vi.resetModules(); configuration.createDiscoveryDependencies.mockReset(); });

  test.each([undefined, "Bearer expired"])("allows browsing without usable credentials: %s", async (authorization) => {
    const authenticate = vi.fn().mockResolvedValue(null);
    const searchPublic = vi.fn().mockResolvedValue([]);
    configuration.createDiscoveryDependencies.mockReturnValue({ authenticate, discoverSessions: { searchPublic } });
    const { GET } = await import("@/app/api/sessions/route");

    const response = await GET(new Request("https://example.test/api/sessions?q=Badminton", {
      headers: authorization ? { authorization } : {},
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith({ text: "Badminton" });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
