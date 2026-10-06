import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "@/app/api/venues/route";
import { getVenueDependencies } from "@/app/venues/server-dependencies";
import { VenueSearchProviderError, VenueSearchUnavailableError } from "@/lib/venues/contracts";
import { readVenueSettings } from "@/app/venues/server-environment";

vi.mock("@/app/venues/server-dependencies", () => ({ getVenueDependencies: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const authenticate = vi.fn(async (): Promise<string | null> => userId);
const search = vi.fn(async () => ({ items: [], nextPage: null }));
beforeEach(() => {
  vi.resetAllMocks(); authenticate.mockResolvedValue(userId); search.mockResolvedValue({ items: [], nextPage: null });
  vi.mocked(getVenueDependencies).mockResolvedValue({ authenticate, search });
});
test("authenticates, validates and paginates without exposing provider fields", async () => {
  const response = await GET(new Request("https://example.com/api/venues?q=%20Court%20&page=2"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ items: [], nextPage: null });
  expect(search).toHaveBeenCalledWith("Court", 2);
});
test("requires verified identity before lookup", async () => {
  authenticate.mockResolvedValue(null);
  expect((await GET(new Request("https://example.com/api/venues?q=Court"))).status).toBe(401);
  expect(search).not.toHaveBeenCalled();
});
test.each(["q=C", "q=Court&q=Other", "q=Court&page=0", "q=Court&page=1&page=2", "q=Court&page=1.5"])("rejects malformed search %s", async (query) => {
  expect((await GET(new Request(`https://example.com/api/venues?${query}`))).status).toBe(400);
  expect(search).not.toHaveBeenCalled();
});
test.each([[new VenueSearchUnavailableError(), 503], [new VenueSearchProviderError("private credential"), 502], [new Error("private credential"), 500]])("returns an opaque lookup failure", async (error, status) => {
  search.mockRejectedValue(error);
  const response = await GET(new Request("https://example.com/api/venues?q=Court"));
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain("private credential");
});
test("missing OneMap credentials leave authenticated manual fallback usable", () => {
  const environment = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture" };
  expect(readVenueSettings(environment)?.credentials).toBeUndefined();
  expect(readVenueSettings({ ...environment, ONEMAP_API_EMAIL: "fixture@example.com", ONEMAP_API_PASSWORD: "fixture-password" })?.credentials?.email).toBe("fixture@example.com");
  expect(readVenueSettings({})).toBeUndefined();
});
