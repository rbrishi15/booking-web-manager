import type { Pool } from "pg";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable, LedgerError } from "@/lib/money/errors";
import { fingerprintOf, PostgresIdempotencyStore } from "@/lib/money/idempotency";
import { PostgresLedgerWriter } from "@/lib/money/ledger-write-adapter";
import type {
  Clock,
  DomainTransaction,
  UnitOfWork,
} from "@/use-cases/shared/contracts";
import { PostgresCommitmentSessionRepository } from "./postgres-commitment-session-repository";
import { SessionPersistenceError } from "./postgres-row-values";
import { PostgresUserReader } from "./postgres-user-reader";

const MAX_ATTEMPTS = 3;

/**
 * Production UnitOfWork for the commitment workflows (UC2-04, UC2-05, UC2-06).
 *
 * Each `execute` runs one READ COMMITTED transaction that:
 * 1. Claims the idempotency key. A key that already succeeded returns its
 *    stored result without running the work again (CLAUDE.md rule #6).
 * 2. Gives the work complete Users, sessions locked `FOR UPDATE`, and a ledger
 *    writer that locks the affected wallets, all on the same connection, so a
 *    commitment and its fund lock commit or roll back together (rule #5).
 * 3. Stores the result under the key in the same transaction.
 *
 * Concurrent commitments to one session serialize on its row lock. READ
 * COMMITTED lets a transaction that waited for that lock read what the holder
 * committed; the snapshot isolation levels would abort it instead, so a busy
 * session could exhaust its retries. The ledger's wallet locks and
 * non-negative balance constraint are designed for this level.
 *
 * Serialization failures and deadlocks restart the whole transaction with
 * fresh repositories, up to three attempts. So does the ledger refusing a
 * lock for insufficient funds: the User was read before another commitment
 * from the same wallet committed, and the retry reloads it so the domain
 * reports the shortfall as its own INSUFFICIENT_FUNDS. The commitment workflows only use
 * users, sessions and the ledger; the other DomainTransaction members fail.
 * Nothing here calls an external service (rule #4).
 */
export class PostgresCommitmentUnitOfWork implements UnitOfWork {
  constructor(
    private readonly getPool: () => Pool,
    private readonly clock: Clock,
  ) {}

  async execute<T>(
    idempotencyKey: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await new PostgresTransactor(
          this.getPool(),
          "read committed",
        ).transaction(async (sql) => {
          const keys = new PostgresIdempotencyStore(sql);
          const claim = await keys.claim({
            idempotencyKey,
            scope: scopeOf(idempotencyKey),
            fingerprint: fingerprintOf(idempotencyKey),
          });
          // The key binds the stored value to this operation's result type.
          if (claim.status === "REPLAY") return claim.value as T;

          const users = new PostgresUserReader(sql, this.clock);
          const result = await work({
            users: { get: (id) => users.get(id), save: unsupported },
            sessions: new PostgresCommitmentSessionRepository(sql),
            ledger: new PostgresLedgerWriter(sql, idempotencyKey),
            groups: { get: unsupported, save: unsupported },
            payouts: { get: unsupported, save: unsupported },
            deactivationInput: { get: unsupported },
            payoutIntents: { append: unsupported },
          });
          await keys.succeed(idempotencyKey, result);
          return result;
        });
      } catch (error) {
        if (shouldRestart(error) && attempt < MAX_ATTEMPTS) continue;
        throw error;
      }
    }
  }
}

function shouldRestart(error: unknown): boolean {
  return (
    isRetryable(error) ||
    (error instanceof LedgerError && error.code === "INSUFFICIENT_FUNDS")
  );
}

/**
 * Commitment keys are JSON arrays whose first element names the operation,
 * such as `["UC2-04", userId, sessionId, key]`.
 */
function scopeOf(idempotencyKey: string): string {
  try {
    const parsed: unknown = JSON.parse(idempotencyKey);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0] !== "")
      return parsed[0];
  } catch {
    // Not a structured key; fall through to the shared scope.
  }
  return "commitment";
}

async function unsupported(): Promise<never> {
  throw new SessionPersistenceError(
    "The commitment unit of work supports only users, sessions and the ledger",
  );
}
