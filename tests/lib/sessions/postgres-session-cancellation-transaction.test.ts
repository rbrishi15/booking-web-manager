import { Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { LedgerError } from "@/lib/money/errors";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresSessionCancellationTransaction } from "@/lib/sessions/postgres-session-cancellation-transaction";
import type { SqlExecutor } from "@/lib/money/sql";

const driver = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn<SqlExecutor["query"]>() }));
vi.mock("@/lib/database/postgres-transactor", () => ({ PostgresTransactor: vi.fn(function () { return { transaction: driver.transaction }; }) }));
beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockResolvedValue([]);
  driver.transaction.mockReset().mockImplementation((work: (sql: SqlExecutor) => Promise<unknown>) => work({ query: driver.query as SqlExecutor["query"] }));
});
test.each(["SERIALISATION_FAILURE", "DEADLOCK"] as const)("restarts the entire cancellation on %s with fresh repositories", async (code) => {
  const pool = new Pool();
  const transaction = new PostgresSessionCancellationTransaction(() => pool, { now: () => new Date() }, "submission");
  const repositories = new Set();
  let attempts = 0;
  expect(await transaction.run(async (context) => {
    repositories.add(context);
    if (++attempts < 3) throw new LedgerError(code, "Retry");
    return "done";
  })).toBe("done");
  expect(repositories.size).toBe(3);
  expect(PostgresTransactor).toHaveBeenCalledWith(pool, "serializable");
  await pool.end();
});
test("bounds retries and preserves nonretryable failures", async () => {
  const pool = new Pool();
  const transaction = new PostgresSessionCancellationTransaction(() => pool, { now: () => new Date() }, "submission");
  const retry = new LedgerError("SERIALISATION_FAILURE", "retry");
  driver.transaction.mockRejectedValue(retry);
  await expect(transaction.run(async () => 1)).rejects.toBe(retry);
  expect(driver.transaction).toHaveBeenCalledTimes(3);
  driver.transaction.mockClear();
  const failure = new Error("mapping failed");
  driver.transaction.mockRejectedValue(failure);
  await expect(transaction.run(async () => 1)).rejects.toBe(failure);
  expect(driver.transaction).toHaveBeenCalledOnce();
  await pool.end();
});
