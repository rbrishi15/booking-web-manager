import type { Pool } from "pg";
import { rethrowDatabaseError } from "@/lib/money/errors";
import type { SqlExecutor, SqlTransactor } from "@/lib/money/sql";

/** All aggregate reads and writes share a consistent transaction snapshot. */
export class PostgresTransactor implements SqlTransactor {
  /**
   * Configures the pool and transaction isolation level, defaulting to REPEATABLE READ.
   * READ COMMITTED suits workflows that serialize on an explicit row lock: a
   * statement that waited for `FOR UPDATE` sees the row the holder committed,
   * where the snapshot levels abort it with a serialization failure instead.
   */
  constructor(
    private readonly pool: Pool,
    private readonly isolation:
      | "read committed"
      | "repeatable read"
      | "serializable" = "repeatable read",
  ) {}

  /** Runs work on one connection, commits before returning, and rolls back on failure; discards the connection if rollback fails. */
  async transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    let discard = false;
    try {
      await connection.query(`begin isolation level ${this.isolation}`);
      const sql: SqlExecutor = {
        query: async (statement, values) => {
          try {
            return (
              await connection.query(
                statement,
                values ? [...values] : undefined,
              )
            ).rows;
          } catch (error) {
            rethrowDatabaseError(error);
          }
        },
      };
      const result = await work(sql);
      await connection.query("commit");
      return result;
    } catch (error) {
      try {
        await connection.query("rollback");
      } catch {
        discard = true;
      }
      rethrowDatabaseError(error);
    } finally {
      connection.release(discard);
    }
  }
}
