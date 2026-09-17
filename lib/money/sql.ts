/**
 * The SQL surface the ledger needs, and nothing more.
 *
 * The adapters in this directory depend on this interface rather than on a
 * concrete driver, for three reasons. The Supabase JS client cannot hold an
 * interactive transaction open, and rule 5 requires the commitment and its fund
 * lock to share one. The driver choice belongs to the repository owner, not to
 * the ledger. And a fake executor lets the concurrency test model row locking
 * without a database.
 *
 * A concrete implementation is a few lines over `pg`:
 *
 * ```ts
 * const transactor: SqlTransactor = {
 *   async transaction(work) {
 *     const client = await pool.connect();
 *     try {
 *       await client.query("begin");
 *       const result = await work({
 *         query: async (text, values) =>
 *           (await client.query(text, values ? [...values] : undefined)).rows,
 *       });
 *       await client.query("commit");
 *       return result;
 *     } catch (error) {
 *       await client.query("rollback");
 *       throw error;
 *     } finally {
 *       client.release();
 *     }
 *   },
 * };
 * ```
 */

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlExecutor {
  /** Runs one parameterised statement. Never interpolate values into `text`. */
  query<TRow extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<readonly TRow[]>;
}

export interface SqlTransactor {
  /**
   * Runs `work` inside a single database transaction, committing if it
   * resolves and rolling back if it rejects.
   */
  transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T>;
}

/** The shape of a driver error this layer knows how to interpret. */
export interface PostgresErrorShape {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

export function isPostgresError(error: unknown): error is PostgresErrorShape {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "constraint" in error)
  );
}
