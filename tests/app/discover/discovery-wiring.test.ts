import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createDiscoveryDependencies } from "@/use-case-config/discovery";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

const driver = vi.hoisted(() => ({
  query: vi.fn<(statement: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  connect: vi.fn(),
  release: vi.fn(),
  getPool: vi.fn(),
  createPoolProvider: vi.fn(),
  authenticate: vi.fn().mockResolvedValue(null),
  createAuthenticator: vi.fn(),
}));

vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/supabase/bearer-auth", () => ({ createSupabaseIdentityAuthenticator: driver.createAuthenticator }));

const userId = "10000000-0000-4000-8000-000000000001";
const walletId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset();
  driver.query.mockImplementation(async (statement) => {
    if (statement.includes("from profiles")) return { rows: [{
      user_id: userId, account_status: "ACTIVE", email: "participant@example.com",
      preferred_sports: [], preferred_regions: [],
    }] };
    if (statement.includes("from wallets")) return { rows: [{ wallet_id: walletId, user_id: userId }] };
    return { rows: [] };
  });
  driver.connect.mockResolvedValue({ query: driver.query, release: driver.release });
  driver.getPool.mockReturnValue({ connect: driver.connect });
  driver.createPoolProvider.mockReturnValue(driver.getPool);
  driver.createAuthenticator.mockReturnValue(driver.authenticate);
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});
afterEach(() => vi.unstubAllEnvs());

test("lazily loads the complete actor and listings through one consistent transaction", async () => {
  const dependencies = createDiscoveryDependencies();
  expect(dependencies.discoverSessions).toBeInstanceOf(DiscoverSessions);
  expect(driver.getPool).not.toHaveBeenCalled();
  await dependencies.authenticate(new Request("http://localhost/api/sessions"));
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:55321", "test-anon-key");
  expect(await dependencies.discoverSessions.forParticipant(userId)).toEqual([]);
  expect(driver.getPool).toHaveBeenCalledOnce();
  expect(driver.connect).toHaveBeenCalledOnce();
  expect(driver.query).toHaveBeenNthCalledWith(1, "begin isolation level repeatable read");
  expect(driver.query).toHaveBeenNthCalledWith(2, expect.stringContaining("from profiles"), [userId]);
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from ledger_entries"), [walletId]);
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from sessions"), [expect.any(Date)]);
  expect(driver.query).toHaveBeenLastCalledWith("commit");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test("rolls back incomplete actor hydration before reading session listings", async () => {
  const read = driver.query.getMockImplementation();
  if (read === undefined) throw new Error("Expected database fixture");
  driver.query.mockImplementation((statement, values) =>
    statement.includes("from wallets") ? Promise.resolve({ rows: [] }) : read(statement, values),
  );
  const dependencies = createDiscoveryDependencies();

  await expect(dependencies.discoverSessions.forParticipant(userId)).rejects.toThrow("Stored user has no wallet");

  expect(driver.query).not.toHaveBeenCalledWith(expect.stringContaining("from sessions"), expect.anything());
  expect(driver.query).toHaveBeenLastCalledWith("rollback");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("missing %s exposes unavailable capabilities without infrastructure", async (name) => {
  vi.stubEnv(name, "");
  const dependencies = createDiscoveryDependencies();
  await expect(dependencies.authenticate(new Request("http://localhost/api/sessions"))).rejects.toBeInstanceOf(DiscoveryApiUnavailableError);
  await expect(dependencies.discoverSessions.forParticipant(userId)).rejects.toBeInstanceOf(DiscoveryApiUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).not.toHaveBeenCalled();
});

test("invalid configured settings fail setup instead of returning unavailable", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe-remote.example/postgres");
  expect(createDiscoveryDependencies).toThrow();
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
