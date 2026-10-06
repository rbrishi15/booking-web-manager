import { Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { LedgerError } from "@/lib/money/errors";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import type { SqlExecutor } from "@/lib/money/sql";

const driver = vi.hoisted(() => ({
  transaction: vi.fn<(work: (sql: SqlExecutor) => Promise<unknown>) => Promise<unknown>>(),
  query: vi.fn<SqlExecutor["query"]>(),
}));
vi.mock("@/lib/database/postgres-transactor", () => ({
  PostgresTransactor: vi.fn(function () { return { transaction: driver.transaction }; }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockResolvedValue([]);
  driver.transaction.mockReset().mockImplementation((work) => work({ query: driver.query as SqlExecutor["query"] }));
});

test("acquires the pool lazily and selects serializable isolation", async () => {
  const pool = new Pool();
  const getPool = vi.fn(() => pool);
  const transaction = new PostgresSessionManagementTransaction(getPool, { now: () => new Date() });
  expect(getPool).not.toHaveBeenCalled();
  expect(await transaction.run(({ sessions }) => sessions.get("missing"))).toBeNull();
  expect(PostgresTransactor).toHaveBeenCalledWith(pool, "serializable");
  await pool.end();
});

test.each(["SERIALISATION_FAILURE", "DEADLOCK"] as const)("restarts the complete workflow on %s with fresh repositories", async (code) => {
  const pool = new Pool();
  const repositories: unknown[] = [];
  const transaction = new PostgresSessionManagementTransaction(() => pool, { now: () => new Date() });
  let attempts = 0;
  const result = await transaction.run(async (loaded) => {
    repositories.push(loaded);
    await loaded.users.get("actor");
    if (++attempts < 3) throw new LedgerError(code, "retry");
    return "saved";
  });
  expect(result).toBe("saved");
  expect(attempts).toBe(3);
  expect(new Set(repositories).size).toBe(3);
  expect(driver.query).toHaveBeenCalledTimes(3);
  await pool.end();
});

test("stops after three failed attempts and does not retry unrelated errors", async () => {
  const pool = new Pool();
  const transaction = new PostgresSessionManagementTransaction(() => pool, { now: () => new Date() });
  const retryable = new LedgerError("SERIALISATION_FAILURE", "retry");
  driver.transaction.mockRejectedValue(retryable);
  await expect(transaction.run(async () => "unreachable")).rejects.toBe(retryable);
  expect(driver.transaction).toHaveBeenCalledTimes(3);
  driver.transaction.mockClear();
  const failure = new Error("bad stored data");
  driver.transaction.mockRejectedValue(failure);
  await expect(transaction.run(async () => "unreachable")).rejects.toBe(failure);
  expect(driver.transaction).toHaveBeenCalledOnce();
  await pool.end();
});
