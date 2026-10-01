import { describe, expect, test } from "vitest";
import { discoveryHref, discoveryReturnTo } from "@/app/discover/navigation";

describe("Discover return navigation", () => {
  test.each([
    "/", "/?sport=Tennis&region=West", "/sessions?tab=hosting", "/wallet", "/profile#preferences", "/groups/join/group-id",
  ])("preserves a supported origin %s", (origin) => {
    expect(discoveryReturnTo(origin)).toBe(origin);
  });

  test.each([
    undefined, null, 3, {}, [], ["/wallet"], ["/wallet", "/profile"], "", "wallet",
    "https://external.example/path", "//external.example/path", "/\\external.example", "/\t/external.example", "/groups/\nmember", "/groups/\u0000member",
    "/login", "/login?next=/wallet", "/register", "/discover", "/discover?q=Tennis", "/discover/more",
    "/api-docs", "/storybook", "/groups-private", "/wallets", "/sessions-other", "/profiled",
    "/groups/../login", "/groups/../register", "/groups/../discover?q=Tennis", "/groups/%2e%2e/discover",
  ])("falls back to Home for unsupported or unsafe origin %j", (origin) => {
    expect(discoveryReturnTo(origin)).toBe("/");
  });

  test.each([
    "/groups/%zz", "/groups/%", "/groups/%00", "/groups/%0a", "/groups/%5cuser",
  ])("falls back to Home for malformed or encoded unsafe origin %s", (origin) => {
    expect(discoveryReturnTo(origin)).toBe("/");
  });

  test("normalizes dot segments before validating a local route", () => {
    expect(discoveryReturnTo("/groups/../wallet?tab=activity")).toBe("/wallet?tab=activity");
    expect(discoveryReturnTo("/groups/%2e%2e/?sport=Tennis")).toBe("/?sport=Tennis");
  });

  test("encodes a return path separately from committed search filters", () => {
    const href = discoveryHref("q=Jurong&sport=Tennis&cursor=page-token", "/?date=2042-08-02&region=West");
    const url = new URL(href, "https://booking.invalid");
    expect(url.pathname).toBe("/discover");
    expect(url.searchParams.get("q")).toBe("Jurong");
    expect(url.searchParams.get("sport")).toBe("Tennis");
    expect(url.searchParams.get("cursor")).toBe("page-token");
    expect(url.searchParams.get("returnTo")).toBe("/?date=2042-08-02&region=West");
  });

  test("keeps the return origin when filters are cleared", () => {
    expect(discoveryHref("", "/wallet")).toBe("/discover?returnTo=%2Fwallet");
    expect(discoveryHref("", "https://external.example")).toBe("/discover?returnTo=%2F");
    expect(discoveryHref("")).toBe("/discover");
  });
});
