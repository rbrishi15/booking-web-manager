import { isRetryable } from "./errors";
import { PostgresIdempotencyStore, fingerprintOf } from "./idempotency";
import { PostgresLedgerWriter } from "./ledger-write-adapter";
import { PostgresLedgerReader } from "./ledger-read-adapter";
import type { SqlExecutor, SqlTransactor } from "./sql";

/**
 * The ledger's slice of a unit of work.
 *
 * `UnitOfWork` in `/use-cases/shared` coordinates aggregate repositories,
 * durable intents and the ledger together, and assembling that belongs to the
 * domain and payments role. What the ledger owns is the part inside it: one
 * transaction, one idempotency claim, ledger writes, commit. A coordinator
 * composes this with the repositories to satisfy the full interface.
 *
 * Rule 4 applies to everything passed to `execute`: no external API call may
 * happen inside it. Holding a row lock open across a network round trip turns
 * the session row into a queue under load.
 */

export interface LedgerWorkRequest {
  /** Unique per logical operation. The caller supplies it; retries reuse it. */
  readonly idempotencyKey: string;
  /** Which operation this is, such as `"UC2-04:commit"`. */
  readonly scope: string;
  /**
   * The request being performed, hashed to detect a key reused with a
   * different body. Give it the same value on a retry.
   */
  readonly request: unknown;
}

export interface LedgerWorkContext {
  /** The open transaction, for a coordinator's own repository work. */
  readonly sql: SqlExecutor;
  readonly ledger: PostgresLedgerWriter;
  readonly read: PostgresLedgerReader;
}

export interface LedgerUnitOfWorkOptions {
  /** Attempts when a transaction deadlocks or loses a serialisation race. */
  readonly maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export class LedgerUnitOfWork {
  readonly #transactor: SqlTransactor;
  readonly #maxAttempts: number;

  constructor(transactor: SqlTransactor, options: LedgerUnitOfWorkOptions = {}) {
    this.#transactor = transactor;
    this.#maxAttempts = Math.max(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1);
  }

  /**
   * Runs `work` once, in one transaction, under one idempotency key.
   *
   * A replay returns the first attempt's result read back out of the key
   * table, so the result must survive a JSON round trip: identifiers, amounts
   * in cents and plain data, not class instances. Anything richer should be
   * rebuilt by the caller from the identifiers it gets back.
   */
  async execute<T>(
    request: LedgerWorkRequest,
    work: (context: LedgerWorkContext) => Promise<T>,
  ): Promise<T> {
    const fingerprint = fingerprintOf(request.request);

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#runOnce(request, fingerprint, work);
      } catch (error) {
        // A deadlock or serialisation failure rolled the whole transaction
        // back, including the idempotency claim, so replaying it is safe.
        if (isRetryable(error) && attempt < this.#maxAttempts) continue;
        throw error;
      }
    }
  }

  async #runOnce<T>(
    request: LedgerWorkRequest,
    fingerprint: string,
    work: (context: LedgerWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.#transactor.transaction(async (sql) => {
      const keys = new PostgresIdempotencyStore(sql);

      const claim = await keys.claim({
        idempotencyKey: request.idempotencyKey,
        scope: request.scope,
        fingerprint,
      });

      if (claim.status === "REPLAY") return claim.value as T;

      const result = await work({
        sql,
        ledger: new PostgresLedgerWriter(sql, request.idempotencyKey),
        read: new PostgresLedgerReader(sql),
      });

      await keys.succeed(request.idempotencyKey, result);

      return result;
    });
  }
}
