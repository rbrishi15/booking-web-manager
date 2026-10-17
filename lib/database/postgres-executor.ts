import type { Pool } from "pg";
import type { SqlExecutor } from "@/lib/money/sql";

/** Adapt the lazy pool to row-only queries without owning a transaction. */
export function createPostgresExecutor(getPool: () => Pool): SqlExecutor {
  return {
    query: async (statement, values) =>
      (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
}
