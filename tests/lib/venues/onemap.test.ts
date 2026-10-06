import { describe, expect, test, vi } from "vitest";
import { OneMapVenueSearch } from "@/lib/venues/onemap";
import { regionForCoordinates } from "@/lib/venues/region";
import { VenueSearchProviderError } from "@/lib/venues/contracts";

const credentials = { email: "fixture@example.com", password: "fixture-password" };
const now = 1_800_000_000_000;
const token = (value = "fixture-token", expiry = now / 1000 + 3600) => Response.json({ access_token: value, expiry_timestamp: String(expiry) });
const providerResult = (overrides = {}) => ({ pageNum: 1, totalNumPages: 2, found: 2,
  results: [{ BUILDING: "JURONG EAST SPORTS HALL", SEARCHVAL: "21 JURONG EAST SPORTS HALL", ADDRESS: "21 JURONG EAST STREET 31", POSTAL: "609517", LATITUDE: "1.333", LONGITUDE: "103.743" }], ...overrides });

describe("OneMap translation and token lifecycle", () => {
  test("uses a supplied token across pages without requesting account credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(providerResult()))
      .mockResolvedValueOnce(Response.json(providerResult({ pageNum: 2 })));
    const search = new OneMapVenueSearch({ accessToken: "supplied-token" }, fetcher, () => now);
    expect((await search.search("Jurong", 1)).items[0]?.region).toBe("West");
    expect((await search.search("Jurong", 2)).nextPage).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetcher.mock.calls) {
      expect(String(url)).toContain("/api/common/elastic/search?");
      expect(request?.headers).toEqual({ Authorization: "supplied-token" });
      expect(request?.body).toBeUndefined();
    }
  });
  test.each([
    new Response("supplied-token", { status: 401 }),
    Response.json(providerResult({ error: "Authentication token expired. supplied-token" })),
    Response.json(providerResult({ error: "Invalid authentication token. supplied-token" })),
  ])("rejects an invalid supplied token without retrying or exposing it", async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    await expect(new OneMapVenueSearch({ accessToken: "supplied-token" }, fetcher, () => now).search("Court", 1))
      .rejects.toThrow("Venue search is temporarily unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test("does not retain upstream secrets in a provider error or its cause", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("rejected supplied-token"));
    const error = await new OneMapVenueSearch({ accessToken: "supplied-token" }, fetcher, () => now)
      .search("Court", 1).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(VenueSearchProviderError);
    expect(String(error)).not.toContain("supplied-token");
    expect(error).not.toHaveProperty("cause");
  });
  test.each([
    "Authentication token expired. Tokens is valid for 3 days.",
    "Invalid authentication token. Please register for an account and provide a valid API token.",
    "Authentication token missing. Please create an account and generate or renew your API Token.",
  ])("renews credentials once after an HTTP 200 authentication error: %s", async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(Response.json(providerResult({ error })))
      .mockResolvedValueOnce(token("refreshed")).mockResolvedValueOnce(Response.json(providerResult()));
    expect((await new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1)).items[0]?.region).toBe("West");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[1]?.headers).toEqual({ Authorization: "refreshed" });
  });
  test("fails after a second HTTP 200 authentication error", async () => {
    const failure = () => Response.json(providerResult({ error: "Authentication token expired. private details" }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(token("refreshed")).mockResolvedValueOnce(failure());
    await expect(new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1))
      .rejects.toThrow("Venue search is temporarily unavailable");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  test.each(["API limit exceeded. private details", { message: "private details" }, null, ""])("rejects other HTTP 200 error payloads without refreshing", async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(providerResult({ error })));
    await expect(new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1))
      .rejects.toThrow("Venue search is temporarily unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("keeps credentials server-side, translates results and reuses the cached token across pages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(providerResult())).mockResolvedValueOnce(Response.json(providerResult({ pageNum: 2 })));
    const search = new OneMapVenueSearch(credentials, fetcher, () => now);
    expect(await search.search("Jurong", 1)).toEqual({ items: [{ venueName: "JURONG EAST SPORTS HALL", address: "21 JURONG EAST STREET 31", postalCode: "609517", latitude: 1.333, longitude: 103.743, region: "West" }], nextPage: 2 });
    expect((await search.search("Jurong", 2)).nextPage).toBeNull();
    expect(fetcher.mock.calls[0]).toMatchObject(["https://www.onemap.gov.sg/api/auth/post/getToken", { method: "POST", body: JSON.stringify(credentials) }]);
    const [url, request] = fetcher.mock.calls[1]!;
    expect(String(url)).toContain("searchVal=Jurong");
    expect(request?.headers).toEqual({ Authorization: "fixture-token" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  test("refreshes once after an expired-token response and fails opaquely if rejected again", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(token("refreshed")).mockResolvedValueOnce(new Response("private upstream details", { status: 401 }));
    await expect(new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1)).rejects.toThrow("Venue search is temporarily unavailable");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[1]?.headers).toEqual({ Authorization: "refreshed" });
  });
  test("retries an expired token with fresh authorization and translates the successful search", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(token("refreshed")).mockResolvedValueOnce(Response.json(providerResult()));
    expect((await new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1)).items[0]?.region).toBe("West");
    expect(fetcher.mock.calls[3]?.[1]?.headers).toEqual({ Authorization: "refreshed" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  test("translates an empty provider search into a completed empty page", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(providerResult({ found: 0, totalNumPages: 0, results: [] })));
    expect(await new OneMapVenueSearch(credentials, fetcher, () => now).search("Unknown", 1)).toEqual({ items: [], nextPage: null });
  });
  test("refreshes an expiring cached token and shares an in-flight token request", async () => {
    let clock = now;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(providerResult()))
      .mockResolvedValueOnce(token("new", now / 1000 + 7200)).mockImplementation(async () => Response.json(providerResult()));
    const provider = new OneMapVenueSearch(credentials, fetcher, () => clock);
    await provider.search("Court", 1);
    clock += 3_550_000;
    await Promise.all([provider.search("Court", 1), provider.search("Court", 2)]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("getToken"))).toHaveLength(2);
  });
  test("falls back to search text and exposes unresolved coordinates for manual region entry", async () => {
    const result = providerResult({ totalNumPages: 1, results: [{ BUILDING: "NIL", SEARCHVAL: "Booked Court", ADDRESS: "Address", POSTAL: "NIL", LATITUDE: "0", LONGITUDE: "0" }] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(result));
    expect(await new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1)).toMatchObject({ items: [{ venueName: "Booked Court", postalCode: "", region: null }], nextPage: null });
  });
  test.each([Response.json({ unexpected: "private details" }), new Response("private details", { status: 500 }), Response.json(providerResult({ results: [{ LATITUDE: "bad" }] }))])("redacts malformed or unavailable provider responses", async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(response);
    await expect(new OneMapVenueSearch(credentials, fetcher, () => now).search("Court", 1)).rejects.toBeInstanceOf(VenueSearchProviderError);
  });
});
describe("Bundled URA region resolution", () => {
  test.each([[1.333, 103.743, "West"], [1.436, 103.786, "North"], [1.391, 103.895, "North-East"], [1.354, 103.945, "East"], [1.351, 103.848, "Central"]])("maps coordinates %s,%s to %s", (lat, lon, region) => {
    expect(regionForCoordinates(Number(lat), Number(lon))).toBe(region);
  });
  test("requires manual entry for nonfinite and out-of-boundary coordinates", () => {
    expect(regionForCoordinates(NaN, 103.8)).toBeNull();
    expect(regionForCoordinates(0, 0)).toBeNull();
    expect(regionForCoordinates(1.2, 103.9)).toBeNull();
  });
});
