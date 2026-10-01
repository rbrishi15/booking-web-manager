import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import type { Clock } from "@/use-cases/shared/contracts";
import type {
  SessionDiscoveryReads,
  SessionDiscoveryTransaction,
} from "@/use-cases/sessions/session-discovery-transaction";
import { PostgresSessionDiscoveryReader } from "./postgres-session-discovery-reader";
import { PostgresUserReader } from "./postgres-user-reader";

/** Read workflow using the aggregate reader's ordinary repeatable-read transaction. */
export class PostgresSessionDiscoveryTransaction implements SessionDiscoveryTransaction {
  constructor(
    private readonly getPool: () => Pool,
    private readonly clock: Clock,
  ) {}

  run<T>(work: (reads: SessionDiscoveryReads) => Promise<T>): Promise<T> {
    return new PostgresTransactor(this.getPool()).transaction((sql) =>
      work({
        users: new PostgresUserReader(sql, this.clock),
        sessions: new PostgresSessionDiscoveryReader(sql),
      }),
    );
  }
}
