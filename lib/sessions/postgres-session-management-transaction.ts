import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import type { Clock } from "@/use-cases/shared/contracts";
import type { SessionManagementRepositories, SessionManagementTransaction } from "@/use-cases/sessions/session-management-transaction";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";
import { PostgresUserReader } from "./postgres-user-reader";

/** Conflicting future lifecycle writers must also use serializable transactions. */
export class PostgresSessionManagementTransaction implements SessionManagementTransaction {
  constructor(private readonly getPool: () => Pool, private readonly clock: Clock) {}

  async run<T>(work: (repositories: SessionManagementRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await new PostgresTransactor(this.getPool(), "serializable").transaction((sql) => work({
          users: new PostgresUserReader(sql, this.clock),
          sessions: new PostgresSessionManagementRepository(sql),
        }));
      } catch (error) {
        if (isRetryable(error) && attempt < 3) continue;
        throw error;
      }
    }
  }
}
