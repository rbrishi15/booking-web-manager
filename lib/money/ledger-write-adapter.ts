import { Money, type FinancialInstruction, type UUID } from "@/domain";
import type { LedgerWritePort } from "@/use-cases/shared/ledger-write-port";
import { toDatabaseCents } from "./cents";
import { LedgerError, rethrowDatabaseError } from "./errors";
import type { SqlExecutor, SqlRow } from "./sql";

/** Inbound money. Written only from the webhook handler (CLAUDE.md rule 2). */
export interface TopUpCredit {
  readonly walletId: UUID;
  readonly amount: Money;
  readonly occurredAt: Date;
  /** The provider's payment identifier, so the credit can be traced back. */
  readonly externalReference: string;
}

/** Outbound money. Written when the provider confirms a payout left. */
export interface PayoutDebit {
  readonly payoutId: UUID;
  readonly sessionId: UUID;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly externalReference: string;
}

const COLUMNS = [
  "kind",
  "amount_cents",
  "occurred_at",
  "idempotency_key",
  "external_reference",
  "wallet_id",
  "holding_account_id",
  "hold_id",
  "session_id",
  "participation_id",
  "payout_id",
] as const;

type Column = (typeof COLUMNS)[number];
type EntryDraft = { readonly [K in Column]: unknown };

/**
 * Appends entries to the ledger inside a caller-supplied transaction.
 *
 * Constructed per transaction, because each entry's idempotency key is derived
 * from the unit of work's key plus the entry's position. That derivation is
 * what makes a retry safe: the same work replayed produces the same keys, and
 * the unique index on `idempotency_key` refuses the second copy even if the
 * middleware above has been bypassed.
 *
 * Balances are not touched here. Inserting the entry is the whole operation;
 * the `apply_ledger_entry` trigger moves the projections, so the invariants
 * hold regardless of which client wrote the row.
 */
export class PostgresLedgerWriter implements LedgerWritePort {
  readonly #sql: SqlExecutor;
  readonly #idempotencyKey: string;
  #sequence = 0;

  constructor(sql: SqlExecutor, idempotencyKey: string) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new LedgerError(
        "INVALID_INSTRUCTION",
        "A ledger writer needs the unit of work's idempotency key",
      );
    }

    this.#sql = sql;
    this.#idempotencyKey = idempotencyKey;
  }

  /** Lock, refund, release and forfeit, as instructed by the domain layer. */
  async append(instructions: readonly FinancialInstruction[]): Promise<void> {
    if (instructions.length === 0) return;

    const drafts = instructions.map((instruction) =>
      this.#draftFrom(instruction),
    );

    await this.#lockWallets(drafts);
    await this.#insert(drafts);
  }

  /** Top-up credit: the fifth money operation, and the only inbound one. */
  async creditTopUp(credit: TopUpCredit): Promise<void> {
    requireMoney(credit.amount, "amount");
    requireId(credit.walletId, "walletId");
    requireText(credit.externalReference, "externalReference");

    await this.#insert([
      {
        kind: "TOP_UP",
        amount_cents: toDatabaseCents(credit.amount),
        occurred_at: requireDate(credit.occurredAt, "occurredAt"),
        idempotency_key: this.#nextKey(),
        external_reference: credit.externalReference,
        wallet_id: credit.walletId,
        holding_account_id: null,
        hold_id: null,
        session_id: null,
        participation_id: null,
        payout_id: null,
      },
    ]);
  }

  /** Records that a settled payout actually left the platform. */
  async recordPayout(debit: PayoutDebit): Promise<void> {
    requireMoney(debit.amount, "amount");
    requireId(debit.payoutId, "payoutId");
    requireId(debit.sessionId, "sessionId");
    requireText(debit.externalReference, "externalReference");

    await this.#insert([
      {
        kind: "PAYOUT",
        amount_cents: toDatabaseCents(debit.amount),
        occurred_at: requireDate(debit.occurredAt, "occurredAt"),
        idempotency_key: this.#nextKey(),
        external_reference: debit.externalReference,
        wallet_id: null,
        holding_account_id: null,
        hold_id: null,
        session_id: debit.sessionId,
        participation_id: null,
        payout_id: debit.payoutId,
      },
    ]);
  }

  /**
   * Returns the user's wallet, creating it at a zero balance if they have none
   * (REQ-5, REQ-6). Safe to call on every registration and on retry.
   */
  async ensureWallet(userId: UUID): Promise<UUID> {
    requireId(userId, "userId");

    const inserted = await this.#query<{ wallet_id: unknown }>(
      `insert into wallets (user_id) values ($1)
       on conflict (user_id) do nothing
       returning wallet_id`,
      [userId],
    );

    const created = inserted[0];
    if (created !== undefined) return String(created.wallet_id);

    const existing = await this.#query<{ wallet_id: unknown }>(
      "select wallet_id from wallets where user_id = $1",
      [userId],
    );

    const row = existing[0];
    if (row === undefined) {
      throw new LedgerError(
        "UNKNOWN_ACCOUNT",
        `No wallet exists for user ${userId} and none could be created`,
      );
    }

    return String(row.wallet_id);
  }

  #draftFrom(instruction: FinancialInstruction): EntryDraft {
    const kind = instruction.kind;
    if (
      kind !== "LOCK" &&
      kind !== "REFUND" &&
      kind !== "RELEASE" &&
      kind !== "FORFEIT"
    ) {
      throw new LedgerError(
        "INVALID_INSTRUCTION",
        `${String(kind)} is not a financial instruction the domain may issue`,
      );
    }

    requireMoney(instruction.amount, "amount");
    requireId(instruction.walletId, "walletId");
    requireId(instruction.holdingAccountId, "holdingAccountId");
    requireId(instruction.holdId, "holdId");
    requireId(instruction.sessionId, "sessionId");
    requireId(instruction.participationId, "participationId");

    const settles = kind === "RELEASE" || kind === "FORFEIT";
    if (settles) {
      requireId(instruction.payoutId, "payoutId");
    } else if (instruction.payoutId !== undefined) {
      throw new LedgerError(
        "INVALID_INSTRUCTION",
        `A ${kind} names a payout, but only a release or forfeiture pays one`,
      );
    }

    return {
      kind,
      amount_cents: toDatabaseCents(instruction.amount),
      occurred_at: requireDate(instruction.occurredAt, "occurredAt"),
      idempotency_key: this.#nextKey(),
      external_reference: null,
      wallet_id: instruction.walletId,
      holding_account_id: instruction.holdingAccountId,
      hold_id: instruction.holdId,
      session_id: instruction.sessionId,
      participation_id: instruction.participationId,
      payout_id: settles ? instruction.payoutId : null,
    };
  }

  /**
   * Takes the wallet row locks up front, in a fixed order.
   *
   * A single-wallet batch needs none of this: the trigger's own
   * `available_cents = available_cents - n` takes the row lock at the right
   * moment, and under READ COMMITTED it re-reads the committed value after
   * waiting, so the non-negative constraint still holds. The pre-locking is for
   * multi-wallet batches such as cancelling a session, where two concurrent
   * transactions touching the same wallets in different orders would deadlock.
   * `for update` sits above the sort in the plan, so the rows lock in the
   * sorted order rather than whatever order the scan produced.
   */
  async #lockWallets(drafts: readonly EntryDraft[]): Promise<void> {
    const walletIds = [
      ...new Set(
        drafts
          .map((draft) => draft.wallet_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ].sort();

    if (walletIds.length < 2) return;

    await this.#query(
      `select b.wallet_id
         from wallet_balances b
        where b.wallet_id = any($1::uuid[])
        order by b.wallet_id
          for update`,
      [walletIds],
    );
  }

  /** One statement, rows applied in the order the domain issued them. */
  async #insert(drafts: readonly EntryDraft[]): Promise<void> {
    const values: unknown[] = [];
    const tuples = drafts.map((draft) => {
      const placeholders = COLUMNS.map((column) => {
        values.push(draft[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    await this.#query(
      `insert into ledger_entries (${COLUMNS.join(", ")})
       values ${tuples.join(", ")}`,
      values,
    );
  }

  #nextKey(): string {
    const key = `${this.#idempotencyKey}#${this.#sequence}`;
    this.#sequence += 1;
    return key;
  }

  async #query<TRow extends SqlRow = SqlRow>(
    text: string,
    values: readonly unknown[],
  ): Promise<readonly TRow[]> {
    try {
      return await this.#sql.query<TRow>(text, values);
    } catch (error) {
      rethrowDatabaseError(error);
    }
  }
}

function requireMoney(value: Money, name: string): void {
  if (!(value instanceof Money) || value.toCents() <= 0) {
    throw new LedgerError(
      "INVALID_INSTRUCTION",
      `${name} must be a positive Money amount`,
    );
  }
}

function requireId(value: unknown, name: string): asserts value is string {
  requireText(value, name);
}

function requireText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LedgerError("INVALID_INSTRUCTION", `${name} is required`);
  }
}

function requireDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new LedgerError("INVALID_INSTRUCTION", `${name} must be a valid date`);
  }
  return new Date(value.getTime());
}
