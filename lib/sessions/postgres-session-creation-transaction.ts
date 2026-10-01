import type { Pool } from "pg";
import type { UUID } from "@/domain";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { LedgerUnitOfWork } from "@/lib/money/ledger-unit-of-work";
import type { Clock } from "@/use-cases/shared/contracts";
import type {
  SessionCreationRepositories,
  SessionCreationTransaction,
} from "@/use-cases/sessions/session-creation-transaction";
import type { SessionCreationSubmission } from "./request-session-creation-transaction";
import { PostgresSessionWriter } from "./postgres-session-writer";
import { PostgresUserReader } from "./postgres-user-reader";

export class PostgresSessionCreationTransaction
  implements SessionCreationTransaction
{
  private readonly unitOfWork: LedgerUnitOfWork;
  private readonly idempotencyKey: string;

  constructor(
    pool: Pool,
    submission: SessionCreationSubmission,
    private readonly clock: Clock,
  ) {
    this.unitOfWork = new LedgerUnitOfWork(new PostgresTransactor(pool));
    this.idempotencyKey = submission.idempotencyKey;
  }

  runForBooker<T>(
    bookerId: UUID,
    work: (repositories: SessionCreationRepositories) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify(["UC2-02", bookerId, this.idempotencyKey]);
    return this.unitOfWork.execute(
      {
        idempotencyKey: key,
        scope: "UC2-02",
        request: { idempotencyKey: key },
      },
      ({ sql }) =>
        work({
          users: new PostgresUserReader(sql, this.clock),
          sessions: new PostgresSessionWriter(sql, bookerId),
        }),
    );
  }
}
