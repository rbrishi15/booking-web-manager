import { once } from "node:events";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  localSupabaseTestContext,
  type LocalSupabaseTestContext,
} from "../support/local-supabase";

describe("session database pool", () => {
  let context: LocalSupabaseTestContext;

  beforeEach(() => {
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("VERCEL_REGION", undefined);
    context = localSupabaseTestContext();
  });

  afterEach(async () => {
    try {
      await context?.pool.end();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("serves two database clients before either request releases its connection", async () => {
    // Arrange
    const first = await context.pool.connect();
    let second: PoolClient | undefined;

    try {
      // Act
      second = await context.pool.connect();
      const connections = await Promise.all([
        first.query<{ pid: number }>("select pg_backend_pid() as pid"),
        second.query<{ pid: number }>("select pg_backend_pid() as pid"),
      ]);

      // Assert
      expect(connections[0].rows[0]?.pid).toBeTypeOf("number");
      expect(connections[1].rows[0]?.pid).toBeTypeOf("number");
      expect(connections[0].rows[0]?.pid).not.toBe(connections[1].rows[0]?.pid);
    } finally {
      second?.release();
      first.release();
    }
  });

  test("closes released idle connections and reconnects for a later query", async () => {
    // Arrange
    const client = await context.pool.connect();
    const removed = once(context.pool, "remove", {
      signal: AbortSignal.timeout(7500),
    });

    // Act: observe removal, allowing a small margin over the five-second timeout.
    client.release();
    await removed;

    // Assert
    expect(context.pool.totalCount).toBe(0);
    expect(context.pool.idleCount).toBe(0);

    // Act
    const result = await context.pool.query<{ connected: number }>(
      "select 1 as connected",
    );

    // Assert
    expect(result.rows).toEqual([{ connected: 1 }]);
    expect(context.pool.totalCount).toBe(1);
  });
});
