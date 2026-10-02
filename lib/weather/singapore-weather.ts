import { z } from "zod";

const FORECAST_URL =
  "https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast";
const CACHE_MILLISECONDS = 5 * 60 * 1000;
const TIMEOUT_MILLISECONDS = 3000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type SingaporeWeather =
  | {
      status: "ready";
      forecast: string;
      lowCelsius: number;
      highCelsius: number;
      validFrom: string;
      validTo: string;
      updatedAt: string;
    }
  | { status: "unavailable" };

const timestamp = z.string().datetime({ offset: true });
const temperature = z
  .object({
    low: z.number().finite().min(-90).max(60),
    high: z.number().finite().min(-90).max(60),
  })
  .refine(({ low, high }) => low <= high);
const record = z.object({
  updatedTimestamp: timestamp,
  general: z.object({
    forecast: z.object({ text: z.string().trim().min(1).max(200) }),
    validPeriod: z.object({ start: timestamp, end: timestamp }),
    temperature,
  }),
});
const responseSchema = z.object({
  code: z.literal(0),
  data: z.object({ records: z.array(record).min(1).max(100) }),
});

function parseCurrentForecast(value: unknown, now: number): SingaporeWeather {
  const response = responseSchema.safeParse(value);
  if (!response.success || !Number.isFinite(now))
    return { status: "unavailable" };

  const current = response.data.data.records
    .filter(({ general, updatedTimestamp }) => {
      const start = Date.parse(general.validPeriod.start);
      const end = Date.parse(general.validPeriod.end);
      const updated = Date.parse(updatedTimestamp);
      return (
        start <= now &&
        now < end &&
        end - start <= DAY_MILLISECONDS &&
        updated <= now &&
        updated >= start - DAY_MILLISECONDS
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right.updatedTimestamp) - Date.parse(left.updatedTimestamp),
    )[0];
  if (!current) return { status: "unavailable" };

  return {
    status: "ready",
    forecast: current.general.forecast.text,
    lowCelsius: current.general.temperature.low,
    highCelsius: current.general.temperature.high,
    validFrom: new Date(current.general.validPeriod.start).toISOString(),
    validTo: new Date(current.general.validPeriod.end).toISOString(),
    updatedAt: new Date(current.updatedTimestamp).toISOString(),
  };
}

/** Server dependency: no user identity, location, cookies, or profile enters this reader. */
export function createSingaporeWeatherReader({
  fetch: fetchForecast = (url, init) => globalThis.fetch(url, init),
  now = () => new Date(),
}: {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
} = {}): () => Promise<SingaporeWeather> {
  let cached:
    | { weather: Extract<SingaporeWeather, { status: "ready" }>; until: number }
    | undefined;
  let pending: Promise<SingaporeWeather> | undefined;

  async function read(): Promise<SingaporeWeather> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = await Promise.race([
        (async () => {
          const response = await fetchForecast(FORECAST_URL, {
            headers: { Accept: "application/json" },
            // Only the validated public forecast is cached, independently of page rendering.
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          if (!response.ok) return undefined;
          return (await response.json()) as unknown;
        })(),
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve(undefined);
          }, TIMEOUT_MILLISECONDS);
        }),
      ]);
      return parseCurrentForecast(payload, now().getTime());
    } catch {
      // A provider, network, or parsing failure must not fail the Home page.
      return { status: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return async () => {
    const time = now().getTime();
    if (
      cached &&
      time < cached.until &&
      Date.parse(cached.weather.validFrom) <= time &&
      time < Date.parse(cached.weather.validTo)
    ) {
      return cached.weather;
    }
    cached = undefined;
    pending ??= read().finally(() => {
      pending = undefined;
    });
    const weather = await pending;
    if (weather.status === "ready") {
      cached = {
        weather,
        until: Math.min(
          now().getTime() + CACHE_MILLISECONDS,
          Date.parse(weather.validTo),
        ),
      };
    }
    return weather;
  };
}

/** Imported only by the server-side Home dependencies, never by views or stories. */
export const getSingaporeWeather = createSingaporeWeatherReader();
