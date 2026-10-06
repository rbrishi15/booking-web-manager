import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readVenueSettings } from "@/app/venues/server-environment";
import { createVenueDependencies } from "@/use-case-config/venues";

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture",
};
const emptyPage = () => Response.json({ pageNum: 1, totalNumPages: 0, results: [] });

beforeEach(() => {
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  vi.stubEnv("ONEMAP_API_EMAIL", "");
  vi.stubEnv("ONEMAP_API_PASSWORD", "");
  vi.stubEnv("ONEMAP_API_TOKEN", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("reads a trimmed server-only access token without account credentials", () => {
  const settings = readVenueSettings({ ...environment, ONEMAP_API_TOKEN: "  supplied-token \n" });
  expect(settings?.accessToken).toBe("supplied-token");
  expect(settings?.credentials).toBeUndefined();
  expect(readVenueSettings({ ...environment, ONEMAP_API_TOKEN: " \n " })?.accessToken).toBeUndefined();
});

test("assembles venue search with only a supplied token", async () => {
  vi.stubEnv("ONEMAP_API_TOKEN", "  supplied-token  ");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(emptyPage());
  vi.stubGlobal("fetch", fetcher);
  expect(await createVenueDependencies().search("Court", 1)).toEqual({ items: [], nextPage: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "supplied-token" });
});

test("prefers renewable account credentials when a supplied token is also configured", async () => {
  vi.stubEnv("ONEMAP_API_EMAIL", "fixture@example.com");
  vi.stubEnv("ONEMAP_API_PASSWORD", "fixture-password");
  vi.stubEnv("ONEMAP_API_TOKEN", "old-supplied-token");
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "renewable-token", expiry_timestamp: Math.floor(Date.now() / 1000) + 3600 }))
    .mockResolvedValueOnce(emptyPage());
  vi.stubGlobal("fetch", fetcher);
  expect(await createVenueDependencies().search("Court", 1)).toEqual({ items: [], nextPage: null });
  expect(fetcher.mock.calls[0]).toMatchObject(["https://www.onemap.gov.sg/api/auth/post/getToken", {
    body: JSON.stringify({ email: "fixture@example.com", password: "fixture-password" }),
  }]);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: "renewable-token" });
});

test("uses a supplied token when account credentials are incomplete", async () => {
  vi.stubEnv("ONEMAP_API_EMAIL", "fixture@example.com");
  vi.stubEnv("ONEMAP_API_TOKEN", "supplied-token");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(emptyPage());
  vi.stubGlobal("fetch", fetcher);
  expect(await createVenueDependencies().search("Court", 1)).toEqual({ items: [], nextPage: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "supplied-token" });
});
