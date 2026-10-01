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

/** One logical submission; separate instances share durable replay state. */
export class PostgresSessionCreationTransaction
  implements SessionCreationTransaction
{
  private readonly idempotencyKey: string;
  private readonly unitOfWork: LedgerUnitOfWork;

  constructor(
    pool: Pool,
    submission: SessionCreationSubmission,
    private readonly clock: Clock,
  ) {
    this.idempotencyKey = submission.idempotencyKey;
    this.unitOfWork = new LedgerUnitOfWork(new PostgresTransactor(pool), {
      maxAttempts: 3,
    });
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
        // Creation deliberately replays the first result even if a retry's
        // body changes. Fingerprint only the stable actor/submission identity.
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
