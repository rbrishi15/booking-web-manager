import {
  LedgerTransaction,
  Money,
  type HoldingAccountBalance,
  type LedgerReadPort,
  type TransactionKind,
  type UUID,
  type WalletBalance,
} from "@/domain";
import { fromDatabaseCents } from "./cents";
import { LedgerError, rethrowDatabaseError } from "./errors";
import type { SqlExecutor, SqlRow } from "./sql";

/** A page of a wallet's history, newest first (REQ-7). */
export interface WalletHistoryQuery {
  readonly walletId: UUID;
  /** Defaults to 50, capped at 200. */
  readonly limit?: number;
  /** Returns only entries strictly older than this, for paging. */
  readonly occurredBefore?: Date;
}

/**
 * The read half of the ledger, which `LedgerReadPort` does not cover.
 *
 * Transaction history is a requirement (REQ-7) but is not on the port, because
 * the port exists for the domain layer and the domain never reads a list of
 * transactions. It belongs in `/domain` if a use case ever needs it; until
 * then it lives here and the wallet page depends on this interface.
 */
export interface WalletHistoryReadPort {
  listWalletTransactions(
    query: WalletHistoryQuery,
  ): Promise<readonly LedgerTransaction[]>;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

/**
 * Reads balances derived from the committed, append-only ledger.
 *
 * Balances come from the trigger-maintained projections rather than by summing
 * entries, which is what keeps a wallet read at one indexed row lookup. The
 * reconciliation job is what proves those projections still agree with the
 * entries they were built from.
 */
export class PostgresLedgerReader
  implements LedgerReadPort, WalletHistoryReadPort
{
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  async getWalletBalance(walletId: UUID): Promise<WalletBalance | null> {
    const rows = await this.#query<WalletBalanceRow>(
      `select b.wallet_id, b.available_cents
         from wallet_balances b
        where b.wallet_id = $1`,
      [walletId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      walletId: readUuid(row.wallet_id, "wallet_id"),
      availableBalance: fromDatabaseCents(row.available_cents, "available_cents"),
    };
  }

  async getHoldingAccountBalance(
    accountId: UUID,
  ): Promise<HoldingAccountBalance | null> {
    const rows = await this.#query<HoldingBalanceRow>(
      `select a.account_id, a.held_cents
         from holding_account_balances a
        where a.account_id = $1`,
      [accountId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      accountId: readUuid(row.account_id, "account_id"),
      heldBalance: fromDatabaseCents(row.held_cents, "held_cents"),
    };
  }

  /** The wallet belonging to a user, or null if they have none yet. */
  async findWalletIdByUserId(userId: UUID): Promise<UUID | null> {
    const rows = await this.#query<{ wallet_id: unknown }>(
      "select wallet_id from wallets where user_id = $1",
      [userId],
    );

    const row = rows[0];
    return row === undefined ? null : readUuid(row.wallet_id, "wallet_id");
  }

  async listWalletTransactions(
    query: WalletHistoryQuery,
  ): Promise<readonly LedgerTransaction[]> {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_HISTORY_LIMIT, 1),
      MAX_HISTORY_LIMIT,
    );

    const rows = await this.#query<LedgerEntryRow>(
      `select entry_id, kind, amount_cents, occurred_at, idempotency_key,
              external_reference, wallet_id, hold_id, payout_id
         from ledger_entries
        where wallet_id = $1
          and ($2::timestamptz is null or occurred_at < $2::timestamptz)
        order by occurred_at desc, entry_id desc
        limit $3`,
      [query.walletId, query.occurredBefore ?? null, limit],
    );

    return rows.map(toLedgerTransaction);
  }

  /**
   * How much of a session's funds are still held.
   *
   * The SRS requires that a session's locked funds equal the sum of its
   * committed participants' shares. This supplies the ledger side of that
   * comparison; the roster side is owned by the session and commitment roles.
   */
  async getSessionHeldTotal(sessionId: UUID): Promise<SessionHeldTotal> {
    const rows = await this.#query<SessionHeldRow>(
      `select session_id, open_holds, held_cents
         from session_held_totals
        where session_id = $1`,
      [sessionId],
    );

    const row = rows[0];
    if (row === undefined) {
      return { sessionId, openHolds: 0, heldBalance: Money.fromCents(0) };
    }

    return {
      sessionId,
      openHolds: readCount(row.open_holds, "open_holds"),
      heldBalance: fromDatabaseCents(row.held_cents, "held_cents"),
    };
  }

  async #query<TRow extends SqlRow>(
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

export interface SessionHeldTotal {
  readonly sessionId: UUID;
  readonly openHolds: number;
  readonly heldBalance: Money;
}

interface WalletBalanceRow extends SqlRow {
  readonly wallet_id: unknown;
  readonly available_cents: unknown;
}

interface HoldingBalanceRow extends SqlRow {
  readonly account_id: unknown;
  readonly held_cents: unknown;
}

interface SessionHeldRow extends SqlRow {
  readonly session_id: unknown;
  readonly open_holds: unknown;
  readonly held_cents: unknown;
}

interface LedgerEntryRow extends SqlRow {
  readonly entry_id: unknown;
  readonly kind: unknown;
  readonly amount_cents: unknown;
  readonly occurred_at: unknown;
  readonly idempotency_key: unknown;
  readonly external_reference: unknown;
  readonly wallet_id: unknown;
  readonly hold_id: unknown;
  readonly payout_id: unknown;
}

function toLedgerTransaction(row: LedgerEntryRow): LedgerTransaction {
  return new LedgerTransaction({
    transactionId: readUuid(row.entry_id, "entry_id"),
    amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
    kind: readKind(row.kind),
    occurredAt: readDate(row.occurred_at, "occurred_at"),
    idempotencyKey: readText(row.idempotency_key, "idempotency_key"),
    externalReference: readOptionalText(
      row.external_reference,
      "external_reference",
    ),
    walletId: readOptionalText(row.wallet_id, "wallet_id"),
    holdId: readOptionalText(row.hold_id, "hold_id"),
    payoutId: readOptionalText(row.payout_id, "payout_id"),
  });
}

const KINDS: readonly TransactionKind[] = [
  "TOP_UP",
  "LOCK",
  "RELEASE",
  "REFUND",
  "FORFEIT",
  "PAYOUT",
];

function readKind(value: unknown): TransactionKind {
  const kind = KINDS.find((candidate) => candidate === value);
  if (kind === undefined) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `ledger_entries.kind holds ${JSON.stringify(value)}, which is not a known transaction kind`,
    );
  }
  return kind;
}

function readText(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `${column} is missing or blank`,
    );
  }
  return value;
}

function readOptionalText(value: unknown, column: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return readText(value, column);
}

function readUuid(value: unknown, column: string): UUID {
  return readText(value, column);
}

function readDate(value: unknown, column: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `${column} holds ${JSON.stringify(value)}, which is not a date`,
    );
  }
  return date;
}

function readCount(value: unknown, column: string): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `${column} holds ${JSON.stringify(value)}, which is not a count`,
    );
  }
  return count;
}
