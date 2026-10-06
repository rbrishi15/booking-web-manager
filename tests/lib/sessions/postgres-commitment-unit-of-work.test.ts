import { Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { LedgerError } from "@/lib/money/errors";
import { fingerprintOf } from "@/lib/money/idempotency";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresCommitmentUnitOfWork } from "@/lib/sessions/postgres-commitment-unit-of-work";

const driver = vi.hoisted(() => ({
  transaction: vi.fn(),
  query: vi.fn<SqlExecutor["query"]>(),
}));
vi.mock("@/lib/database/postgres-transactor", () => ({
  PostgresTransactor: vi.fn(function () {
    return { transaction: driver.transaction };
  }),
}));

const key = JSON.stringify(["UC2-04", "user", "session", "submission"]);
const clock = { now: () => new Date("2026-10-08T10:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset().mockImplementation(async (text) =>
    text.includes("insert into idempotency_keys")
      ? [{ idempotency_key: key }]
      : [],
  );
  driver.transaction
    .mockReset()
    .mockImplementation((work: (sql: SqlExecutor) => Promise<unknown>) =>
      work({ query: driver.query as SqlExecutor["query"] }),
    );
});

test("runs the work in one serializable transaction and stores its result under the key", async () => {
  const pool = new Pool();
  const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);

  const result = await unitOfWork.execute(key, async () => ({ kind: "COMMITTED" }));

  expect(result).toEqual({ kind: "COMMITTED" });
  expect(PostgresTransactor).toHaveBeenCalledWith(pool, "read committed");
  const claim = driver.query.mock.calls.find(([text]) =>
    text.includes("insert into idempotency_keys"),
  );
  expect(claim?.[1]).toEqual([key, "UC2-04", fingerprintOf(key)]);
  const stored = driver.query.mock.calls.find(([text]) =>
    text.includes("set status = 'SUCCEEDED'"),
  );
  expect(stored?.[1]).toEqual([key, JSON.stringify({ value: { kind: "COMMITTED" } })]);
  await pool.end();
});

test("replays a succeeded key without running the work again", async () => {
  driver.query.mockImplementation(async (text) => {
    if (text.includes("insert into idempotency_keys")) return [];
    if (text.includes("from idempotency_keys"))
      return [
        {
          status: "SUCCEEDED",
          request_fingerprint: fingerprintOf(key),
          response: { value: { kind: "WAITLISTED" } },
        },
      ];
    return [];
  });
  const pool = new Pool();
  const work = vi.fn();

  const result = await new PostgresCommitmentUnitOfWork(() => pool, clock).execute(
    key,
    work,
  );

  expect(result).toEqual({ kind: "WAITLISTED" });
  expect(work).not.toHaveBeenCalled();
  await pool.end();
});

test.each(["SERIALISATION_FAILURE", "DEADLOCK", "INSUFFICIENT_FUNDS"] as const)(
  "restarts the whole transaction on %s with fresh repositories",
  async (code) => {
    const pool = new Pool();
    const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);
    const sessionRepositories = new Set<unknown>();
    let attempts = 0;

    const result = await unitOfWork.execute(key, async (transaction) => {
      sessionRepositories.add(transaction.sessions);
      if (++attempts < 3) throw new LedgerError(code, "retry");
      return "done";
    });

    expect(result).toBe("done");
    expect(sessionRepositories.size).toBe(3);
    await pool.end();
  },
);

test("gives up after three attempts and does not retry other failures", async () => {
  const pool = new Pool();
  const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);
  const retry = new LedgerError("SERIALISATION_FAILURE", "retry");
  driver.transaction.mockRejectedValue(retry);

  await expect(unitOfWork.execute(key, async () => 1)).rejects.toBe(retry);
  expect(driver.transaction).toHaveBeenCalledTimes(3);

  driver.transaction.mockClear();
  const failure = new Error("mapping failed");
  driver.transaction.mockRejectedValue(failure);
  await expect(unitOfWork.execute(key, async () => 1)).rejects.toBe(failure);
  expect(driver.transaction).toHaveBeenCalledOnce();
  await pool.end();
});

test("uses a shared scope for keys that do not name their operation", async () => {
  const pool = new Pool();

  await new PostgresCommitmentUnitOfWork(() => pool, clock).execute(
    "plain-key",
    async () => null,
  );

  const claim = driver.query.mock.calls.find(([text]) =>
    text.includes("insert into idempotency_keys"),
  );
  expect(claim?.[1]?.[1]).toBe("commitment");
  await pool.end();
});

test("rejects repositories the commitment workflows do not use", async () => {
  const pool = new Pool();

  await expect(
    new PostgresCommitmentUnitOfWork(() => pool, clock).execute(
      key,
      async (transaction) => transaction.payouts.get("payout"),
    ),
  ).rejects.toMatchObject({ name: "SessionPersistenceError" });
  await pool.end();
});
