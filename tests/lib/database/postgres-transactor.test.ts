import { Pool } from "pg";
import { beforeEach, expect, test, vi } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";

const driver = vi.hoisted(() => {
  const query =
    vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const on = vi.fn();
  const attach = vi.fn();
  return { query, release, connect, on, attach };
});

vi.mock("pg", () => ({
  Pool: vi.fn(function () {
    return { connect: driver.connect, on: driver.on };
  }),
}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: driver.attach }));

beforeEach(() => {
  vi.clearAllMocks();
  driver.query.mockReset();
  driver.query.mockResolvedValue({ rows: [] });
});

test("the shared pool is constructed and attached only on first submission", () => {
  const getPool = createPostgresPoolProvider("postgresql://localhost/postgres");
  expect(Pool).not.toHaveBeenCalled();
  const first = getPool();
  expect(getPool()).toBe(first);
  expect(Pool).toHaveBeenCalledOnce();
  expect(Pool).toHaveBeenCalledWith(
    expect.objectContaining({ max: 2, connectionTimeoutMillis: 5000 }),
  );
  expect(driver.attach).toHaveBeenCalledExactlyOnceWith(first);
});

test("commits work in a repeatable-read snapshot and releases the connection", async () => {
  const transactor = new PostgresTransactor(new Pool());
  const result = await transactor.transaction(async (sql) => {
    await sql.query("select $1", ["test"]);
    return { sessionId: "stored-session" };
  });
  expect(result).toEqual({ sessionId: "stored-session" });
  expect(driver.query.mock.calls).toEqual([
    ["begin isolation level repeatable read"],
    ["select $1", ["test"]],
    ["commit"],
  ]);
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test("rolls back callback failure before reusing the connection", async () => {
  const failure = new Error("Write failed");
  await expect(
    new PostgresTransactor(new Pool()).transaction(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(driver.query.mock.calls).toEqual([
    ["begin isolation level repeatable read"],
    ["rollback"],
  ]);
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test("allows session management to opt into serializable without changing the default", async () => {
  await new PostgresTransactor(new Pool(), "serializable").transaction(async () => "result");
  expect(driver.query.mock.calls).toEqual([
    ["begin isolation level serializable"],
    ["commit"],
  ]);
});

test("a commit serialization failure remains retryable", async () => {
  driver.query
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce({ code: "40001" });
  await expect(
    new PostgresTransactor(new Pool()).transaction(async () => "result"),
  ).rejects.toMatchObject({ code: "SERIALISATION_FAILURE" });
  expect(driver.query).toHaveBeenLastCalledWith("rollback");
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
});

test("discards a broken connection when rollback fails and preserves the original failure", async () => {
  const original = new Error("Original failure");
  driver.query
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(new Error("Connection lost"));
  await expect(
    new PostgresTransactor(new Pool()).transaction(async () => {
      throw original;
    }),
  ).rejects.toBe(original);
  expect(driver.release).toHaveBeenCalledExactlyOnceWith(true);
});
