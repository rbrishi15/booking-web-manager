import type { Pool } from "pg";
import { bookingAccountIneligibility, DomainError, type UUID } from "@/domain";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { LedgerUnitOfWork } from "@/lib/money/ledger-unit-of-work";
import type { SqlExecutor } from "@/lib/money/sql";
import type { Clock } from "@/use-cases/shared/contracts";
import type {
  SessionCreationRepositories,
  SessionCreationTransaction,
} from "@/use-cases/sessions/session-creation-transaction";
import type { SessionCreationSubmission } from "./request-session-creation-transaction";
import { PostgresSessionWriter } from "./postgres-session-writer";
import { PostgresUserReader } from "./postgres-user-reader";
import { choice } from "./postgres-row-values";

export class PostgresSessionCreationTransaction
  implements SessionCreationTransaction
{
  private readonly transactor: PostgresTransactor;
  private readonly idempotencyKey: string;

  constructor(
    pool: Pool,
    submission: SessionCreationSubmission,
    private readonly clock: Clock,
  ) {
    this.transactor = new PostgresTransactor(pool);
    this.idempotencyKey = submission.idempotencyKey;
  }

  runForBooker<T>(
    bookerId: UUID,
    work: (repositories: SessionCreationRepositories) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify(["UC2-02", bookerId, this.idempotencyKey]);
    // Authorize every transaction attempt before a durable replay can reveal its room token.
    // Keep payout and booking-time rules inside new creation, preserving eligible replay.
    const unitOfWork = new LedgerUnitOfWork({
      transaction: (perform) => this.transactor.transaction(async (sql) => {
        await assertCurrentBookerAccess(sql, bookerId);
        return perform(sql);
      }),
    });
    return unitOfWork.execute(
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

/** Only trusted account facts are read before replay; complete hydration remains creation-owned. */
async function assertCurrentBookerAccess(sql: SqlExecutor, bookerId: UUID): Promise<void> {
  const rows = await sql.query(
    `select p.account_status, u.email
     from profiles p join auth.users u on u.id = p.user_id
     where p.user_id = $1 for share of p, u`,
    [bookerId],
  );
  const account = rows[0];
  DomainError.require(account !== undefined, "NOT_FOUND", "User was not found");
  const accountStatus = choice(account.account_status, ["ACTIVE", "INACTIVE"]);
  const hasEmail = typeof account.email === "string" && account.email.trim() !== "";
  const reason = bookingAccountIneligibility({
    accountStatus,
    hasEmail,
  });
  if (reason !== undefined)
    throw new DomainError(reason, reason === "INACTIVE_ACCOUNT"
      ? "An inactive booker cannot create a session"
      : "Add an email address before creating a session");
}
