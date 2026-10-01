import { Pool, type PoolConfig } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { expect, test, vi } from "vitest";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";

vi.mock("pg", async (importOriginal) => {
  const pg = await importOriginal<typeof import("pg")>();
  return {
    ...pg,
    Pool: vi.fn(function createPool(config: PoolConfig) {
      return new pg.Pool(config);
    }),
  };
});

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

test("lazily shares one pool registered with the serverless lifecycle", async () => {
  // Arrange
  const getPool = createPostgresPoolProvider(
    "postgresql://user:password@localhost:54322/postgres",
  );
  expect(Pool).not.toHaveBeenCalled();
  expect(attachDatabasePool).not.toHaveBeenCalled();

  // Act
  const pool = getPool();
  try {
    const reused = getPool();

    // Assert
    expect(reused).toBe(pool);
    expect(Pool).toHaveBeenCalledOnce();
    expect(attachDatabasePool).toHaveBeenCalledExactlyOnceWith(pool);
    expect(pool.totalCount).toBe(0);
  } finally {
    await pool.end();
  }
});
