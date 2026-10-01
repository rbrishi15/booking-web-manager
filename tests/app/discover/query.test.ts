import { describe, expect, test } from "vitest";
import { buildDiscoveryQuery, encodeDiscoveryCursor, parseDiscoveryQuery } from "@/app/discover/query";

const parse = (query: string) => parseDiscoveryQuery(new URLSearchParams(query));

describe("discovery query boundary", () => {
  test("omits blanks and unknown fields from the default search", () => {
    expect(parse("sport=+&region=&ignored=secret")).toMatchObject({
      status: "valid", input: {}, queryKey: "",
    });
  });

  test("uses the Singapore calendar day including its midnight and excluding the next", () => {
    expect(parse("date=2028-02-29")).toMatchObject({
      status: "valid", input: {
        startAtFrom: new Date("2028-02-28T16:00:00Z"),
        startAtBefore: new Date("2028-02-29T16:00:00Z"),
      },
    });
  });

  test.each([
    ["timeFrom=18:00&timeTo=20:00", "2030-01-01T10:00:00Z", "2030-01-01T12:00:00Z"],
    ["timeFrom=18:00", "2030-01-01T10:00:00Z", "2030-01-01T16:00:00Z"],
    ["timeTo=10:00", "2029-12-31T16:00:00Z", "2030-01-01T02:00:00Z"],
  ])("converts %s to UTC bounds", (times, from, before) => {
    expect(parse(`sport=Badminton&region=North-East&date=2030-01-01&${times}`)).toMatchObject({
      status: "valid", input: {
        sport: "Badminton", region: "North-East",
        startAtFrom: new Date(from), startAtBefore: new Date(before),
      },
    });
  });

  test.each([
    ["sport=Cricket", "sport"], ["region=South", "region"],
    ["date=2030-02-30", "date"], ["date=2027-02-29", "date"],
    ["date=0000-01-01", "date"], ["date=30-01-01", "date"],
    ["timeFrom=09:00", "date"], ["timeTo=10:00", "date"],
    ["date=2030-01-01&timeFrom=24:00", "timeFrom"],
    ["date=2030-01-01&timeTo=09:60", "timeTo"],
    ["date=2030-01-01&timeFrom=19:00&timeTo=19:00", "timeTo"],
    ["date=2030-01-01&timeFrom=23:00&timeTo=01:00", "timeTo"],
    ["date=2030-01-01&timeTo=00:00", "timeTo"],
    ["sport=Badminton&sport=Tennis", "sport"],
    ["region=&region=West", "region"], ["cursor=&cursor=", "cursor"],
    ["cursor=not-json", "cursor"], ["cursor=%3D", "cursor"],
  ])("rejects %s", (query, field) => {
    expect(parse(query)).toMatchObject({ status: "invalid", fieldErrors: { [field]: expect.any(Array) } });
  });

  test("retains invalid duplicate parameters in the key until corrected", () => {
    expect(parse("region=West&region=East").queryKey).toBe("region=West&region=East");
  });

  test("round-trips a validated opaque cursor", () => {
    const cursor = { startAt: "2030-01-01T10:00:00.000Z", sessionId: "10000000-0000-4000-8000-000000000001" };
    const query = buildDiscoveryQuery({ sport: "Badminton", region: "North-East", date: "", timeFrom: "", timeTo: "" }, encodeDiscoveryCursor(cursor));
    expect(parse(query)).toMatchObject({ status: "valid", input: { cursor } });
  });

  test.each([
    { startAt: "2030-02-30T10:00:00Z", sessionId: "bad-id" },
    { startAt: "2030-01-01T10:00:00Z", sessionId: "bad-id" },
    { startAt: "2030-01-01T10:00:00Z", sessionId: "10000000-0000-4000-8000-000000000001", roomToken: "private" },
  ])("rejects malformed cursor shape", (cursor) => {
    const encoded = btoa(JSON.stringify(cursor)).replace(/=+$/, "");
    expect(parse(`cursor=${encoded}`)).toMatchObject({ status: "invalid", fieldErrors: { cursor: expect.any(Array) } });
  });
});
