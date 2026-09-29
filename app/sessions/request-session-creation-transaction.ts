import type { UUID } from "@/domain";
import type {
  SessionCreationRepositories,
  SessionCreationTransaction,
} from "@/use-cases/sessions/session-creation-transaction";
import type { UnitOfWork } from "@/use-cases/shared/contracts";
import type { SessionCreationSubmission } from "./create-session-input";

/**
 * Binds creation to one logical submission. Rebuild it with the same key for a
 * retry, or a new key for a new session. The unit of work atomically persists
 * the session and replay result; this adapter does not implement storage.
 */
export class RequestSessionCreationTransaction
  implements SessionCreationTransaction
{
  private readonly idempotencyKey: string;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    submission: SessionCreationSubmission,
  ) {
    this.idempotencyKey = submission.idempotencyKey;
  }

  runForBooker<T>(
    bookerId: UUID,
    work: (repositories: SessionCreationRepositories) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify(["UC2-02", bookerId, this.idempotencyKey]);

    return this.unitOfWork.execute(key, (transaction) =>
      work({ users: transaction.users, sessions: transaction.sessions }),
    );
  }
}
