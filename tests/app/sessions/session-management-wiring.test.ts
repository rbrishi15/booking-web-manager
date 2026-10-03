import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSessionManagementDependencies } from "@/use-case-config/session-management";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";
import { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";

const driver = vi.hoisted(() => ({ query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(), connect: vi.fn(), release: vi.fn(), getPool: vi.fn(), createPoolProvider: vi.fn(), authenticate: vi.fn(), createAuthenticator: vi.fn() }));
vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/supabase/bearer-auth", () => ({ createSupabaseIdentityAuthenticator: driver.createAuthenticator }));
const bookerId = "10000000-0000-4000-8000-000000000001";
const walletId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  driver.query.mockImplementation(async (sql) => {
    if (sql.includes("from profiles")) return { rows: [{ user_id: bookerId, account_status: "ACTIVE", email: "booker@example.com", email_confirmed_at: null, preferred_sports: [], preferred_regions: [] }] };
    if (sql.includes("from wallets")) return { rows: [{ wallet_id: walletId, user_id: bookerId }] };
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

test("assembles direct use cases and lazy infrastructure, loading complete account state serializably", async () => {
  const dependencies = createSessionManagementDependencies();
  expect(dependencies.toggleVisibility).toBeInstanceOf(ToggleSessionVisibility);
  expect(dependencies.listHostedSessions).toBeInstanceOf(ListHostedSessions);
  expect(driver.getPool).not.toHaveBeenCalled();
  await dependencies.authenticate(new Request("http://localhost/api/sessions"));
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:55321", "test-anon-key");
  expect(await dependencies.listHostedSessions.forBooker(bookerId)).toEqual([]);
  expect(driver.query).toHaveBeenNthCalledWith(1, "begin isolation level serializable");
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from ledger_entries"), [walletId]);
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from sessions"), [bookerId, expect.any(Date)]);
  expect(driver.query).toHaveBeenLastCalledWith("commit");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("missing %s exposes unavailable capabilities without infrastructure", async (name) => {
  vi.stubEnv(name, "");
  const dependencies = createSessionManagementDependencies();
  await expect(dependencies.authenticate(new Request("http://localhost/api/sessions"))).rejects.toBeInstanceOf(SessionManagementUnavailableError);
  await expect(dependencies.listHostedSessions.forBooker(bookerId)).rejects.toBeInstanceOf(SessionManagementUnavailableError);
  await expect(dependencies.toggleVisibility.forBooker(bookerId, bookerId, "PRIVATE")).rejects.toBeInstanceOf(SessionManagementUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).not.toHaveBeenCalled();
});

test("invalid settings fail initialization before assembling adapters", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe.example/postgres");
  expect(createSessionManagementDependencies).toThrow();
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
