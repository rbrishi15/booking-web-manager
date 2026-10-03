import type { Pool } from "pg";
import { rethrowDatabaseError } from "@/lib/money/errors";
import type { SqlExecutor, SqlTransactor } from "@/lib/money/sql";

/** All aggregate reads and writes share a consistent transaction snapshot. */
export class PostgresTransactor implements SqlTransactor {
  /** Configures the pool and transaction isolation level, defaulting to REPEATABLE READ. */
  constructor(
    private readonly pool: Pool,
    private readonly isolation: "repeatable read" | "serializable" = "repeatable read",
  ) {}

  /** Runs work on one connection, commits before returning, and rolls back on failure; discards the connection if rollback fails. */
  async transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    let discard = false;
    try {
      await connection.query(
        this.isolation === "serializable"
          ? "begin isolation level serializable"
          : "begin isolation level repeatable read",
      );
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
