import type { Pool } from "pg";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresDueSessionQuery } from "./postgres-due-session-query";
import { PostgresVerificationReminderQuery } from "./postgres-verification-reminder-query";

/**
 * Creates the scheduled sweep's Postgres queries over the shared pool. Each
 * query is a single autocommit statement, so they run on pooled connections
 * outside the commitment unit of work.
 */
export function createPostgresSchedulingQueries(getPool: () => Pool) {
  const sql: SqlExecutor = {
    query: async (statement, values) =>
      (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
  return {
    dueSessions: new PostgresDueSessionQuery(sql),
    verificationReminders: new PostgresVerificationReminderQuery(sql),
  };
}
