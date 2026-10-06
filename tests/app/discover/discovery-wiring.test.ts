import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createDiscoveryDependencies } from "@/use-case-config/discovery";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";

const driver = vi.hoisted(() => ({
  query: vi.fn<(statement: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  connect: vi.fn(), release: vi.fn(), getPool: vi.fn(), createPoolProvider: vi.fn(), createAuthenticator: vi.fn(),
}));
vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/supabase/bearer-auth", () => ({ createSupabaseIdentityAuthenticator: driver.createAuthenticator }));

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset().mockResolvedValue({ rows: [] });
  driver.connect.mockResolvedValue({ query: driver.query, release: driver.release });
  driver.getPool.mockReturnValue({ connect: driver.connect });
  driver.createPoolProvider.mockReturnValue(driver.getPool);
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

test("public discovery needs only database settings and never hydrates an account", async () => {
  const dependencies = createDiscoveryDependencies();
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(await dependencies.discoverSessions.searchPublic()).toEqual([]);
  expect(driver.query.mock.calls).toEqual([
    ["begin isolation level repeatable read"],
    [expect.stringContaining("from sessions"), [expect.any(Date)]],
    ["commit"],
  ]);
  expect(driver.createAuthenticator).not.toHaveBeenCalled();
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});
test("rolls back listing failures and releases the connection", async () => {
  driver.query.mockImplementation(async (statement) => {
    if (statement.includes("from sessions")) throw new Error("Listing unavailable");
    return { rows: [] };
  });
  await expect(createDiscoveryDependencies().discoverSessions.searchPublic()).rejects.toThrow("Listing unavailable");
  expect(driver.query).toHaveBeenLastCalledWith("rollback");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});
test("missing database configuration returns unavailable without opening infrastructure", async () => {
  vi.stubEnv("DATABASE_URL", "");
  await expect(createDiscoveryDependencies().discoverSessions.searchPublic()).rejects.toBeInstanceOf(DiscoveryApiUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
test("invalid database settings fail setup instead of returning unavailable", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe-remote.example/postgres");
  expect(createDiscoveryDependencies).toThrow();
});
