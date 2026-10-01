import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/** Share one pool, constructing it only when a validated submission needs it. */
export function createPostgresPoolProvider(connectionString: string): () => Pool {
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
      pool.on("error", () => {
        console.error("Session database pool encountered an idle connection error");
      });
    }
    return pool;
  };
}
