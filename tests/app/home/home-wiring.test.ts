import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HomeUnavailableError } from "@/app/home/dependencies";
import { createHomeDependencies } from "@/use-case-config/home";
import { ListUpcomingBookings } from "@/use-cases/sessions/ListUpcomingBookings";

const driver = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getPool: vi.fn(),
  createPoolProvider: vi.fn(),
  weather: vi.fn(),
}));

vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/weather/singapore-weather", () => ({ getSingaporeWeather: driver.weather }));

beforeEach(() => {
  vi.clearAllMocks();
  driver.getPool.mockReturnValue({ query: driver.query });
  driver.createPoolProvider.mockReturnValue(driver.getPool);
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});
afterEach(() => vi.unstubAllEnvs());

test("assembles lazy read infrastructure and performs a separate identity-scoped read for every caller", async () => {
  const dependencies = createHomeDependencies();
  expect(dependencies.upcomingBookings).toBeInstanceOf(ListUpcomingBookings);
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.weather).not.toHaveBeenCalled();
  for (const userId of ["first-user", "second-user"]) {
    expect(await dependencies.upcomingBookings.list(userId)).toEqual([]);
    expect(driver.query).toHaveBeenLastCalledWith(expect.stringContaining("from sessions"), [userId, expect.any(Date), 20]);
  }
  expect(driver.query).toHaveBeenCalledTimes(2);
  expect(driver.createPoolProvider).toHaveBeenCalledExactlyOnceWith("postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  expect(dependencies.weather).toBe(driver.weather);
  expect(driver.weather).not.toHaveBeenCalled();
});

test.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("missing %s returns an unavailable capability without opening infrastructure", async (name) => {
  vi.stubEnv(name, "");
  const dependencies = createHomeDependencies();
  await expect(dependencies.upcomingBookings.list("verified-user")).rejects.toBeInstanceOf(HomeUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.weather).not.toHaveBeenCalled();
});

test("rejects unsafe database configuration before acquiring a pool", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe-remote.example/postgres");
  expect(createHomeDependencies).toThrow();
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.weather).not.toHaveBeenCalled();
});
