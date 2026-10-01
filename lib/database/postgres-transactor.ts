import type { Pool } from "pg";
import { rethrowDatabaseError } from "@/lib/money/errors";
import type { SqlExecutor, SqlTransactor } from "@/lib/money/sql";

/** A coherent snapshot for aggregate hydration across several SQL queries. */
export class PostgresTransactor implements SqlTransactor {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discardClient = false;
    try {
      await client.query("begin isolation level repeatable read");
      const sql: SqlExecutor = {
        query: async (text, values) => {
          try {
            return (await client.query(text, values ? [...values] : undefined))
              .rows;
          } catch (error) {
            rethrowDatabaseError(error);
          }
        },
      };
      const result = await work(sql);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // A broken connection must never return to the pool. Preserve the
        // original failure, including a retryable error raised by COMMIT.
        discardClient = true;
      }
      rethrowDatabaseError(error);
    } finally {
      client.release(discardClient);
    }
  }
}
