import { z } from "zod";
import { VenueSearchProviderError, type VenueSearchPage } from "./contracts";
import { regionForCoordinates } from "./region";

const tokenSchema = z.object({ access_token: z.string().min(1), expiry_timestamp: z.coerce.number().int().safe().positive() });
const responseSchema = z.object({
  pageNum: z.number().int().positive(), totalNumPages: z.number().int().nonnegative(),
  results: z.array(z.object({
    BUILDING: z.string(), SEARCHVAL: z.string(), ADDRESS: z.string(), POSTAL: z.string(),
    LATITUDE: z.coerce.number().finite().min(-90).max(90),
    LONGITUDE: z.coerce.number().finite().min(-180).max(180),
  })),
});

/** OneMap's credentials, token lifecycle and response translation stay outside the core. */
export class OneMapVenueSearch {
  private token: z.infer<typeof tokenSchema> | undefined;
  private tokenRequest: Promise<string> | undefined;

  constructor(private readonly credentials: { readonly email: string; readonly password: string },
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiry_timestamp * 1000 > this.now() + 60_000) return this.token.access_token;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const response = await this.fetcher("https://www.onemap.gov.sg/api/auth/post/getToken", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.credentials), signal: AbortSignal.timeout(5000), cache: "no-store",
      });
      if (!response.ok) throw new VenueSearchProviderError("Venue provider authentication failed");
      this.token = tokenSchema.parse(await response.json());
      if (this.token.expiry_timestamp * 1000 <= this.now() + 60_000)
        throw new VenueSearchProviderError("Venue provider returned an expired token");
      return this.token.access_token;
    })();
    try { return await this.tokenRequest; } finally { this.tokenRequest = undefined; }
  }

  async search(query: string, page: number): Promise<VenueSearchPage> {
    try {
      const url = new URL("https://www.onemap.gov.sg/api/common/elastic/search");
      url.search = new URLSearchParams({ searchVal: query, returnGeom: "Y", getAddrDetails: "Y", pageNum: String(page) }).toString();
      const request = async () => this.fetcher(url, {
        headers: { Authorization: await this.accessToken() }, signal: AbortSignal.timeout(5000), cache: "no-store",
      });
      let response = await request();
      if (response.status === 401) { this.token = undefined; response = await request(); }
      if (!response.ok) throw new VenueSearchProviderError("Venue search failed");
      const result = responseSchema.parse(await response.json());
      return {
        items: result.results.map((item) => ({
          venueName: item.BUILDING !== "NIL" && item.BUILDING.trim() ? item.BUILDING : item.SEARCHVAL,
          address: item.ADDRESS, postalCode: item.POSTAL === "NIL" ? "" : item.POSTAL,
          latitude: item.LATITUDE, longitude: item.LONGITUDE,
          region: regionForCoordinates(item.LATITUDE, item.LONGITUDE),
        })),
        nextPage: result.pageNum < result.totalNumPages ? result.pageNum + 1 : null,
      };
    } catch (cause) {
      throw new VenueSearchProviderError("Venue search is temporarily unavailable", { cause });
    }
  }
}
