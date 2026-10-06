import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import type {
  SessionDiscoveryReads,
  SessionDiscoveryTransaction,
} from "@/use-cases/sessions/session-discovery-transaction";
import { PostgresSessionDiscoveryReader } from "./postgres-session-discovery-reader";

/** Public listing reads never hydrate accounts or acquire account locks. */
export class PostgresSessionDiscoveryTransaction implements SessionDiscoveryTransaction {
  constructor(
    private readonly getPool: () => Pool,
  ) {}

  run<T>(work: (reads: SessionDiscoveryReads) => Promise<T>): Promise<T> {
    return new PostgresTransactor(this.getPool()).transaction((sql) =>
      work({
        sessions: new PostgresSessionDiscoveryReader(sql),
      }),
    );
  }
}
