import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import type { Clock } from "@/use-cases/shared/contracts";
import type { SessionEditingRepositories, SessionEditingTransaction } from "@/use-cases/sessions/session-editing-transaction";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";
import { PostgresUserReader } from "./postgres-user-reader";

export class PostgresSessionEditingTransaction implements SessionEditingTransaction {
  constructor(private readonly getPool: () => Pool, private readonly clock: Clock) {}

  async run<T>(work: (repositories: SessionEditingRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await new PostgresTransactor(this.getPool(), "serializable").transaction((sql) => work({
          users: new PostgresUserReader(sql, this.clock), sessions: new PostgresSessionManagementRepository(sql),
        }));
      } catch (error) {
        if (isRetryable(error) && attempt < 3) continue;
        throw error;
      }
    }
  }
}
