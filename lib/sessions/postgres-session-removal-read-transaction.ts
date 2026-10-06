import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import type { Clock } from "@/use-cases/shared/contracts";
import type { SessionRemovalReadRepositories, SessionRemovalReadTransaction } from "@/use-cases/sessions/session-removal-transaction";
import { PostgresSessionRemovalRepository } from "./postgres-session-removal-repository";
import { PostgresSessionParticipantNames } from "./postgres-session-participant-names";
import { PostgresUserReader } from "./postgres-user-reader";

/** Shares cancellation's serializable read/locking contract without exposing writes. */
export class PostgresSessionRemovalReadTransaction implements SessionRemovalReadTransaction {
  constructor(private readonly getPool: () => Pool, private readonly clock: Clock) {}

  async run<T>(work: (repositories: SessionRemovalReadRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await new PostgresTransactor(this.getPool(), "serializable").transaction((sql) => work({
          users: new PostgresUserReader(sql, this.clock),
          sessions: new PostgresSessionRemovalRepository(sql),
          participants: new PostgresSessionParticipantNames(sql),
        }));
      } catch (error) {
        if (isRetryable(error) && attempt < 3) continue;
        throw error;
      }
    }
  }
}
