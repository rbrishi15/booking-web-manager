import { afterEach, describe, expect, it, vi } from "vitest";
import { createSingaporeWeatherReader } from "@/lib/weather/singapore-weather";

const NOW = new Date("2026-10-01T12:00:00Z");

function record() {
  return {
    updatedTimestamp: "2026-10-01T18:20:54+08:00",
    general: {
      forecast: { text: "Thundery Showers" },
      validPeriod: {
        start: "2026-10-01T18:00:00+08:00",
        end: "2026-10-02T18:00:00+08:00",
      },
      temperature: { low: 25, high: 34 },
    },
  };
}

function payload(records = [record()]) {
  return { code: 0, data: { records } };
}

function setup(body: unknown = payload()) {
  const fetch = vi.fn(async () => Response.json(body));
  const now = vi.fn(() => NOW);
  return { fetch, now, read: createSingaporeWeatherReader({ fetch, now }) };
}

afterEach(() => vi.useRealTimers());

describe("Singapore weather", () => {
  it("reads and serializes the national forecast without location or credentials", async () => {
    const { read, fetch } = setup();
    expect(await read()).toEqual({
      status: "ready",
      forecast: "Thundery Showers",
      lowCelsius: 25,
      highCelsius: 34,
      validFrom: "2026-10-01T10:00:00.000Z",
      validTo: "2026-10-02T10:00:00.000Z",
      updatedAt: "2026-10-01T10:20:54.000Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("selects the most recent currently valid record, irrespective of ordering", async () => {
    const older = record();
    older.updatedTimestamp = "2026-10-01T18:00:00+08:00";
    older.general.forecast.text = "Cloudy";
    const { read } = setup(payload([record(), older]));
    expect(await read()).toMatchObject({ forecast: "Thundery Showers" });
  });

  it("uses an inclusive start and exclusive end", async () => {
    const item = record();
    item.updatedTimestamp = item.general.validPeriod.start;
    const { read, now } = setup(payload([item]));
    now.mockReturnValue(new Date(item.general.validPeriod.start));
    expect(await read()).toMatchObject({ status: "ready" });
    now.mockReturnValue(new Date(item.general.validPeriod.end));
    expect(await read()).toEqual({ status: "unavailable" });
  });

  it.each([
    ["empty records", { code: 0, data: { records: [] } }],
    ["provider error", { code: 1, errorMsg: "Service failed" }],
    ["missing shape", {}],
    [
      "string temperatures",
      {
        code: 0,
        data: {
          records: [
            {
              ...record(),
              general: {
                ...record().general,
                temperature: { low: "25", high: "34" },
              },
            },
          ],
        },
      },
    ],
  ])("does not invent weather for %s", async (_label, body) => {
    expect(await setup(body).read()).toEqual({ status: "unavailable" });
  });

  it.each([
    [
      "invalid update date",
      (item: ReturnType<typeof record>) => {
        item.updatedTimestamp = "2026-02-30T10:00:00Z";
      },
    ],
    [
      "missing timezone",
      (item: ReturnType<typeof record>) => {
        item.general.validPeriod.start = "2026-10-01T10:00:00";
      },
    ],
    [
      "reversed interval",
      (item: ReturnType<typeof record>) => {
        item.general.validPeriod.end = "2026-10-01T09:00:00Z";
      },
    ],
    [
      "expired forecast",
      (item: ReturnType<typeof record>) => {
        item.general.validPeriod.end = NOW.toISOString();
      },
    ],
    [
      "future forecast",
      (item: ReturnType<typeof record>) => {
        item.general.validPeriod.start = "2026-10-01T13:00:00Z";
      },
    ],
    [
      "future update",
      (item: ReturnType<typeof record>) => {
        item.updatedTimestamp = "2026-10-01T13:00:00Z";
      },
    ],
    [
      "stale update",
      (item: ReturnType<typeof record>) => {
        item.updatedTimestamp = "2026-09-28T13:00:00Z";
      },
    ],
    [
      "oversized interval",
      (item: ReturnType<typeof record>) => {
        item.general.validPeriod.end = "2026-10-04T10:00:00Z";
      },
    ],
    [
      "blank text",
      (item: ReturnType<typeof record>) => {
        item.general.forecast.text = "  ";
      },
    ],
    [
      "reversed temperatures",
      (item: ReturnType<typeof record>) => {
        item.general.temperature.low = 35;
      },
    ],
    [
      "out of bounds temperature",
      (item: ReturnType<typeof record>) => {
        item.general.temperature.high = 100;
      },
    ],
  ])("rejects %s", async (_label, change) => {
    const item = record();
    change(item);
    expect(await setup(payload([item])).read()).toEqual({
      status: "unavailable",
    });
  });

  it("caches only successful weather for five minutes", async () => {
    const { read, now, fetch } = setup();
    const first = await read();
    now.mockReturnValue(new Date(NOW.getTime() + 299_999));
    expect(await read()).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    now.mockReturnValue(new Date(NOW.getTime() + 300_000));
    expect(await read()).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares simultaneous requests", async () => {
    const { read, fetch } = setup();
    const results = await Promise.all([read(), read(), read()]);
    expect(results.every((value) => value.status === "ready")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never keeps a cached forecast beyond its valid period", async () => {
    const { read, now, fetch } = setup();
    now.mockReturnValue(new Date("2026-10-02T09:59:00Z"));
    expect(await read()).toMatchObject({ status: "ready" });
    now.mockReturnValue(new Date("2026-10-02T10:00:00Z"));
    expect(await read()).toEqual({ status: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds the entire request, aborts it, and does not cache a timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Promise<Response>(() => {});
    });
    const read = createSingaporeWeatherReader({ fetch, now: () => NOW });
    const result = read();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ status: "unavailable" });
    expect(signal?.aborted).toBe(true);
    fetch.mockResolvedValueOnce(Response.json(payload()));
    expect(await read()).toMatchObject({ status: "ready" });
  });

  it("also bounds an unresponsive response body", async () => {
    vi.useFakeTimers();
    const response = new Response();
    vi.spyOn(response, "json").mockReturnValue(new Promise(() => {}));
    const read = createSingaporeWeatherReader({
      fetch: async () => response,
      now: () => NOW,
    });
    const result = read();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ status: "unavailable" });
  });

  it.each([
    ["HTTP error", async () => new Response("Rate limited", { status: 429 })],
    ["invalid JSON", async () => new Response("not-json")],
    [
      "network error",
      async (): Promise<Response> => {
        throw new Error("Private upstream diagnostics");
      },
    ],
  ])(
    "returns only unavailable for %s and retries the next call",
    async (_label, failure) => {
      const fetch = vi.fn(failure);
      const read = createSingaporeWeatherReader({ fetch, now: () => NOW });
      expect(await read()).toEqual({ status: "unavailable" });
      fetch.mockResolvedValueOnce(Response.json(payload()));
      expect(await read()).toMatchObject({ status: "ready" });
    },
  );
});
