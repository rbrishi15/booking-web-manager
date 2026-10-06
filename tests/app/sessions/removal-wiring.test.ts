import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSessionRemovalDependencies } from "@/use-case-config/removal";
import { SessionRemovalUnavailableError } from "@/app/sessions/removal-unavailable";
import { ListSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";
import { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";

const driver = vi.hoisted(() => ({ query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(), connect: vi.fn(), release: vi.fn(), getPool: vi.fn(), createPoolProvider: vi.fn(), authenticate: vi.fn(), createAuthenticator: vi.fn() }));
vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));
vi.mock("@/lib/supabase/bearer-auth", () => ({ createSupabaseIdentityAuthenticator: driver.createAuthenticator }));
const bookerId = "10000000-0000-4000-8000-000000000001";
const walletId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const participationId = "40000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  driver.query.mockImplementation(async (sql) => {
    if (sql.includes("from profiles")) return { rows: [{ user_id: bookerId, account_status: "ACTIVE", email: "booker@example.com", preferred_sports: [], preferred_regions: [] }] };
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

test("assembles direct coordinators and lazy serializable infrastructure with a fresh removal per submission", async () => {
  const dependencies = createSessionRemovalDependencies();
  expect(dependencies.listParticipants).toBeInstanceOf(ListSessionParticipants);
  expect(dependencies.previewRemoval).toBeInstanceOf(PreviewParticipantRemoval);
  const first = dependencies.createRemoval({ idempotencyKey: "first" });
  const second = dependencies.createRemoval({ idempotencyKey: "second" });
  expect(first).toBeInstanceOf(RemoveParticipant);
  expect(second).toBeInstanceOf(RemoveParticipant);
  expect(first).not.toBe(second);
  expect(driver.getPool).not.toHaveBeenCalled();
  await dependencies.authenticate(new Request("http://localhost"));
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:55321", "test-anon-key");
  await expect(dependencies.listParticipants.forBooker(bookerId, sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(driver.query).toHaveBeenNthCalledWith(1, "begin isolation level serializable");
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from ledger_entries"), [walletId]);
  expect(driver.query).toHaveBeenCalledWith(expect.stringContaining("from sessions"), [sessionId]);
  expect(driver.query).toHaveBeenLastCalledWith("rollback");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("missing %s exposes removal-specific unavailable capabilities without infrastructure", async (name) => {
  vi.stubEnv(name, "");
  const dependencies = createSessionRemovalDependencies();
  await expect(dependencies.authenticate(new Request("http://localhost"))).rejects.toBeInstanceOf(SessionRemovalUnavailableError);
  await expect(dependencies.listParticipants.forBooker(bookerId, sessionId)).rejects.toBeInstanceOf(SessionRemovalUnavailableError);
  await expect(dependencies.previewRemoval.forBooker(bookerId, sessionId, participationId)).rejects.toBeInstanceOf(SessionRemovalUnavailableError);
  await expect(dependencies.createRemoval({ idempotencyKey: "key" }).forBooker(bookerId, sessionId, participationId, "version")).rejects.toBeInstanceOf(SessionRemovalUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
  expect(driver.createAuthenticator).not.toHaveBeenCalled();
});

test("invalid settings fail initialization before assembling adapters", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unsafe.example/postgres");
  expect(createSessionRemovalDependencies).toThrow();
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
