import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/** Share connections within one runtime, opening the pool only for a parsed submission. */
export function createPostgresPoolProvider(
  connectionString: string,
): () => Pool {
  let pool: Pool | undefined;
  return () => {
    if (pool === undefined) {
      pool = new Pool({
        connectionString,
        max: 2,
        min: 0,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 5000,
      });
      attachDatabasePool(pool);
      // An idle connection failure must not become an uncaught EventEmitter error.
      pool.on("error", () =>
        console.error(
          "Session database pool encountered an idle connection error",
        ),
      );
    }
    return pool;
  };
}
