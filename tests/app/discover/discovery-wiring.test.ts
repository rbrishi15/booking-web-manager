import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createDiscoveryDependencies } from "@/use-case-config/discovery";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

const driver = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getPool: vi.fn(),
  createPoolProvider: vi.fn(),
  authenticate: vi.fn().mockResolvedValue(null),
  createAuthenticator: vi.fn(),
}));

vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/supabase/bearer-auth", () => ({ createSupabaseSessionAuthenticator: driver.createAuthenticator }));

beforeEach(() => {
  vi.clearAllMocks();
  driver.getPool.mockReturnValue({ query: driver.query });
  driver.createPoolProvider.mockReturnValue(driver.getPool);
  driver.createAuthenticator.mockReturnValue(driver.authenticate);
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});
afterEach(() => vi.unstubAllEnvs());

test("assembles a real use case without opening the pool until its first read", async () => {
  const dependencies = createDiscoveryDependencies();
  expect(dependencies.discoverSessions).toBeInstanceOf(DiscoverSessions);
  expect(driver.getPool).not.toHaveBeenCalled();
  await dependencies.authenticate(new Request("http://localhost/api/sessions"));
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:55321", "test-anon-key");
  expect(await dependencies.discoverSessions.search({})).toEqual({ items: [], nextCursor: null });
  expect(driver.getPool).toHaveBeenCalledOnce();
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from sessions"), [expect.any(Date), 21]);
});

test.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("missing %s exposes unavailable capabilities without infrastructure", async (name) => {
  vi.stubEnv(name, "");
  const dependencies = createDiscoveryDependencies();
  await expect(dependencies.authenticate(new Request("http://localhost/api/sessions"))).rejects.toBeInstanceOf(DiscoveryApiUnavailableError);
  await expect(dependencies.discoverSessions.search({})).rejects.toBeInstanceOf(DiscoveryApiUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).not.toHaveBeenCalled();
});

test("invalid configured settings fail setup instead of returning unavailable", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe-remote.example/postgres");
  expect(createDiscoveryDependencies).toThrow();
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
