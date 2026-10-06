import { Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { LedgerError } from "@/lib/money/errors";
import { fingerprintOf } from "@/lib/money/idempotency";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresSessionRemovalTransaction } from "@/lib/sessions/postgres-session-removal-transaction";
import { PostgresSessionRemovalReadTransaction } from "@/lib/sessions/postgres-session-removal-read-transaction";
import type { SqlExecutor } from "@/lib/money/sql";

const driver = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn<SqlExecutor["query"]>() }));
vi.mock("@/lib/database/postgres-transactor", () => ({ PostgresTransactor: vi.fn(function () { return { transaction: driver.transaction }; }) }));
beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset().mockResolvedValue([]);
  driver.transaction.mockReset().mockImplementation((work: (sql: SqlExecutor) => Promise<unknown>) => work({ query: driver.query as SqlExecutor["query"] }));
});
const sessionId = "00000000-0000-4000-8000-000000000001";
const participationId = "00000000-0000-4000-8000-000000000002";
const result = { sessionId, participationId, status: "REMOVED" as const, refundCents: 733 };
const clock = { now: () => new Date("2040-01-01T00:00:00Z") };

test.each(["SERIALISATION_FAILURE", "DEADLOCK"] as const)("restarts removal on %s with fresh repositories at serializable isolation", async (code) => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
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

test.each(["read", "write"] as const)("bounds %s retries and preserves nonretryable failures", async (kind) => {
  const pool = new Pool();
  const transaction = kind === "read" ? new PostgresSessionRemovalReadTransaction(() => pool, clock)
    : new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
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

test("namespaces submission by use case and actor and fingerprints target and preview", async () => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
  driver.query.mockResolvedValueOnce([{ idempotency_key: "claimed" }]).mockResolvedValueOnce([]);
  const perform = vi.fn(async () => result);
  expect(await transaction.run(({ submission }) => submission.once("booker", sessionId, participationId, "version", perform))).toEqual(result);
  const key = JSON.stringify(["UC2-03b", "booker", "submission"]);
  expect(driver.query.mock.calls[0]?.[1]).toEqual([key, "UC2-03b", fingerprintOf({ sessionId, participationId, previewVersion: "version" })]);
  expect(driver.query.mock.calls[1]?.[1]).toEqual([key, JSON.stringify({ value: result })]);
  expect(perform).toHaveBeenCalledOnce();
  await pool.end();
});

test("replays validated results without invoking domain work or writing ledger entries", async () => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
  driver.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: "SUCCEEDED",
    request_fingerprint: fingerprintOf({ sessionId, participationId, previewVersion: "version" }), response: { value: result } }]);
  const perform = vi.fn(async () => result);
  expect(await transaction.run(({ submission }) => submission.once("booker", sessionId, participationId, "version", perform))).toEqual(result);
  expect(perform).not.toHaveBeenCalled();
  expect(driver.query).toHaveBeenCalledTimes(2);
  await pool.end();
});

test.each(["participation", "session", "preview"] as const)("rejects same-key changed %s input", async (change) => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
  driver.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: "SUCCEEDED",
    request_fingerprint: fingerprintOf({ sessionId, participationId, previewVersion: "version" }), response: { value: result } }]);
  const perform = vi.fn(async () => result);
  await expect(transaction.run(({ submission }) => submission.once("booker", change === "session" ? "other" : sessionId,
    change === "participation" ? "other" : participationId, change === "preview" ? "other" : "version", perform)))
    .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(perform).not.toHaveBeenCalled();
  await pool.end();
});

test.each([
  { ...result, participationId: "00000000-0000-4000-8000-000000000003" },
  { ...result, sessionId: "00000000-0000-4000-8000-000000000003" },
  { ...result, refundCents: 0.5 },
  { ...result, extra: "untrusted" },
])("rejects corrupt replay output %j", async (corrupt) => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
  driver.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: "SUCCEEDED",
    request_fingerprint: fingerprintOf({ sessionId, participationId, previewVersion: "version" }), response: { value: corrupt } }]);
  const perform = vi.fn(async () => result);
  await expect(transaction.run(({ submission }) => submission.once("booker", sessionId, participationId, "version", perform))).rejects.toThrow();
  expect(perform).not.toHaveBeenCalled();
  await pool.end();
});

test("does not allow a ledger write before the submission claim", async () => {
  const pool = new Pool();
  const transaction = new PostgresSessionRemovalTransaction(() => pool, clock, "submission");
  await expect(transaction.run(({ ledger }) => ledger.append([]))).rejects.toMatchObject({ name: "SessionPersistenceError" });
  expect(driver.query).not.toHaveBeenCalled();
  await pool.end();
});
