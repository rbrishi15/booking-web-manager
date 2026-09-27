import type { SqlExecutor, SqlRow, SqlTransactor } from "@/lib/money";

/**
 * An in-memory stand-in for the ledger schema, with row locking.
 *
 * What it is for: running the concurrency test in CI, where there is no
 * database. It models the parts of migration 0001 the write path touches —
 * the apply trigger, the non-negative wallet constraint, the all-or-nothing
 * hold constraint and the unique idempotency key — and it models
 * `select ... for update` as a mutex held until the transaction ends.
 *
 * What it is not: evidence that the SQL is correct. This is a second
 * implementation of the same rules, so a bug in the real trigger would not show
 * up here. `ledger-concurrency.db.test.ts` runs the same scenario against real
 * Postgres and is what actually proves the row locking works. This one proves
 * the adapter and the locking discipline around it.
 *
 * Two deliberate simplifications. Writes are applied in place with an undo log
 * rather than through an overlay, so an unlocked read could see uncommitted
 * data; every row the tests care about is locked, so it does not arise. And
 * `fake_sessions` stands in for the sessions table, which belongs to another
 * member and does not exist yet.
 */

export interface FakeWallet {
  readonly walletId: string;
  readonly userId: string;
}

export interface FakeHold {
  readonly holdId: string;
  readonly walletId: string;
  readonly sessionId: string;
  readonly participationId: string;
  readonly holdingAccountId: string;
  readonly originalCents: number;
  heldCents: number;
  settledKind: string | null;
}

export interface FakeEntry {
  readonly kind: string;
  readonly amountCents: number;
  readonly idempotencyKey: string;
  readonly walletId: string | null;
  readonly holdId: string | null;
  readonly sessionId: string | null;
  readonly payoutId: string | null;
}

export interface FakePayable {
  readonly payoutId: string;
  readonly sessionId: string;
  payableCents: number;
  paidOutCents: number;
}

export interface FakeSession {
  readonly sessionId: string;
  readonly capacity: number;
  committed: number;
}

interface FakeIdempotencyKey {
  readonly scope: string;
  readonly fingerprint: string;
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  response: string | null;
}

/** Mirrors the driver error shape `translateDatabaseError` reads. */
export function postgresError(
  code: string,
  constraint: string | undefined,
  message: string,
): Error {
  return Object.assign(new Error(message), { code, constraint });
}

class LockTable {
  readonly #holders = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    // Re-checked after each wait, so several waiters queue rather than all
    // proceeding when the first holder releases.
    while (this.#holders.has(key)) {
      await this.#holders.get(key);
    }

    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = () => {
        this.#holders.delete(key);
        resolve();
      };
    });

    this.#holders.set(key, held);
    return release;
  }
}

export class FakeLedgerDatabase implements SqlTransactor {
  readonly wallets = new Map<string, FakeWallet>();
  readonly balances = new Map<string, number>();
  readonly holds = new Map<string, FakeHold>();
  readonly payables = new Map<string, FakePayable>();
  readonly sessions = new Map<string, FakeSession>();
  readonly entries: FakeEntry[] = [];
  readonly keys = new Map<string, FakeIdempotencyKey>();

  readonly #locks = new LockTable();

  /** Creates a wallet at the given starting balance (REQ-5 defaults to zero). */
  addWallet(walletId: string, availableCents = 0): void {
    this.wallets.set(walletId, { walletId, userId: `user-of-${walletId}` });
    this.balances.set(walletId, availableCents);
  }

  addSession(sessionId: string, capacity: number): void {
    this.sessions.set(sessionId, { sessionId, capacity, committed: 0 });
  }

  balanceOf(walletId: string): number {
    return this.balances.get(walletId) ?? 0;
  }

  totalHeldFor(sessionId: string): number {
    let total = 0;
    for (const hold of this.holds.values()) {
      if (hold.sessionId === sessionId) total += hold.heldCents;
    }
    return total;
  }

  async transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction(this, this.#locks);
    try {
      const result = await work(transaction);
      transaction.commit();
      return result;
    } catch (error) {
      transaction.rollback();
      throw error;
    } finally {
      transaction.releaseLocks();
    }
  }
}

class FakeTransaction implements SqlExecutor {
  readonly #db: FakeLedgerDatabase;
  readonly #locks: LockTable;
  readonly #held = new Map<string, () => void>();
  readonly #undo: (() => void)[] = [];

  constructor(db: FakeLedgerDatabase, locks: LockTable) {
    this.#db = db;
    this.#locks = locks;
  }

  async query<TRow extends SqlRow = SqlRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly TRow[]> {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql.startsWith("insert into idempotency_keys")) {
      return (await this.#claimKey(values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("select status, request_fingerprint, response")) {
      return (await this.#readKey(values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("update idempotency_keys set status = 'SUCCEEDED'")) {
      return (await this.#completeKey(values, "SUCCEEDED")) as unknown as readonly TRow[];
    }
    if (sql.startsWith("update idempotency_keys set status = 'FAILED'")) {
      return (await this.#completeKey(values, "FAILED")) as unknown as readonly TRow[];
    }
    if (sql.startsWith("update idempotency_keys set status = 'IN_PROGRESS'")) {
      return (await this.#reclaimKey(values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("select b.wallet_id from wallet_balances")) {
      return (await this.#lockWallets(values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("insert into ledger_entries")) {
      return (await this.#insertEntries(sql, values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("select capacity, committed from fake_sessions")) {
      return (await this.#readSession(values)) as unknown as readonly TRow[];
    }
    if (sql.startsWith("update fake_sessions")) {
      return (await this.#commitSlot(values)) as unknown as readonly TRow[];
    }

    throw new Error(
      `FakeLedgerDatabase does not model this statement, which means the adapter's SQL changed: ${sql}`,
    );
  }

  commit(): void {
    this.#undo.length = 0;
  }

  rollback(): void {
    for (const undo of this.#undo.reverse()) undo();
    this.#undo.length = 0;
  }

  releaseLocks(): void {
    for (const release of this.#held.values()) release();
    this.#held.clear();
  }

  /**
   * Takes a row lock, held until the transaction ends. A transaction that
   * already holds the key proceeds without re-acquiring it, which is what stops
   * the apply step deadlocking against the wallets locked up front.
   */
  async #lock(key: string): Promise<void> {
    if (this.#held.has(key)) return;
    this.#held.set(key, await this.#locks.acquire(key));
  }

  async #claimKey(values: readonly unknown[]): Promise<SqlRow[]> {
    const [key, scope, fingerprint] = values as [string, string, string];
    await this.#lock(`key:${key}`);

    if (this.#db.keys.has(key)) return [];

    this.#db.keys.set(key, {
      scope,
      fingerprint,
      status: "IN_PROGRESS",
      response: null,
    });
    this.#undo.push(() => this.#db.keys.delete(key));

    return [{ idempotency_key: key }];
  }

  async #readKey(values: readonly unknown[]): Promise<SqlRow[]> {
    const [key] = values as [string];
    const row = this.#db.keys.get(key);
    if (row === undefined) return [];

    return [
      {
        status: row.status,
        request_fingerprint: row.fingerprint,
        response: row.response,
      },
    ];
  }

  async #completeKey(
    values: readonly unknown[],
    status: "SUCCEEDED" | "FAILED",
  ): Promise<SqlRow[]> {
    const [key, payload] = values as [string, string];
    const row = this.#db.keys.get(key);
    if (row === undefined) return [];

    const previousStatus = row.status;
    const previousResponse = row.response;
    row.status = status;
    if (status === "SUCCEEDED") row.response = payload;
    this.#undo.push(() => {
      row.status = previousStatus;
      row.response = previousResponse;
    });

    return [];
  }

  async #reclaimKey(values: readonly unknown[]): Promise<SqlRow[]> {
    const [key, fingerprint] = values as [string, string];
    const row = this.#db.keys.get(key);
    if (row === undefined || row.status !== "FAILED") return [];
    if (row.fingerprint !== fingerprint) return [];

    row.status = "IN_PROGRESS";
    return [{ idempotency_key: key }];
  }

  async #lockWallets(values: readonly unknown[]): Promise<SqlRow[]> {
    const [walletIds] = values as [string[]];
    // Sorted, matching the adapter's ordering, so two transactions locking the
    // same pair cannot deadlock.
    for (const walletId of [...walletIds].sort()) {
      await this.#lock(`wallet:${walletId}`);
    }
    return [];
  }

  async #readSession(values: readonly unknown[]): Promise<SqlRow[]> {
    const [sessionId] = values as [string];
    await this.#lock(`session:${sessionId}`);

    const session = this.#db.sessions.get(sessionId);
    if (session === undefined) return [];

    return [{ capacity: session.capacity, committed: session.committed }];
  }

  async #commitSlot(values: readonly unknown[]): Promise<SqlRow[]> {
    const [sessionId] = values as [string];
    await this.#lock(`session:${sessionId}`);

    const session = this.#db.sessions.get(sessionId);
    if (session === undefined) return [];

    session.committed += 1;
    this.#undo.push(() => {
      session.committed -= 1;
    });

    return [];
  }

  async #insertEntries(
    sql: string,
    values: readonly unknown[],
  ): Promise<SqlRow[]> {
    const columns = readColumns(sql);
    const width = columns.length;

    for (let offset = 0; offset < values.length; offset += width) {
      const row: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        row[column] = values[offset + index];
      });
      await this.#applyEntry(row);
    }

    return [];
  }

  /** The TypeScript twin of `apply_ledger_entry()` in migration 0001. */
  async #applyEntry(row: Record<string, unknown>): Promise<void> {
    const kind = String(row.kind);
    const amount = Number(row.amount_cents);
    const idempotencyKey = String(row.idempotency_key);
    const walletId = optional(row.wallet_id);
    const holdId = optional(row.hold_id);
    const payoutId = optional(row.payout_id);
    const sessionId = optional(row.session_id);

    if (this.#db.entries.some((entry) => entry.idempotencyKey === idempotencyKey)) {
      throw postgresError(
        "23505",
        "ledger_entries_idempotency_key_uidx",
        `duplicate key value violates unique constraint for ${idempotencyKey}`,
      );
    }

    switch (kind) {
      case "TOP_UP":
        await this.#moveWallet(requireId(walletId), amount);
        break;

      case "LOCK":
        await this.#moveWallet(requireId(walletId), -amount);
        await this.#openHold(row, amount);
        break;

      case "REFUND":
        await this.#settleHold(requireId(holdId), amount, "REFUND");
        await this.#moveWallet(requireId(walletId), amount);
        break;

      case "RELEASE":
      case "FORFEIT":
        await this.#settleHold(requireId(holdId), amount, kind);
        await this.#creditPayable(
          requireId(payoutId),
          requireId(sessionId),
          amount,
        );
        break;

      case "PAYOUT":
        await this.#debitPayable(requireId(payoutId), amount);
        break;

      default:
        throw postgresError("22000", undefined, `unhandled kind ${kind}`);
    }

    const entry: FakeEntry = {
      kind,
      amountCents: amount,
      idempotencyKey,
      walletId: walletId ?? null,
      holdId: holdId ?? null,
      sessionId: sessionId ?? null,
      payoutId: payoutId ?? null,
    };
    this.#db.entries.push(entry);
    this.#undo.push(() => {
      const index = this.#db.entries.indexOf(entry);
      if (index >= 0) this.#db.entries.splice(index, 1);
    });
  }

  async #moveWallet(walletId: string, delta: number): Promise<void> {
    await this.#lock(`wallet:${walletId}`);

    if (!this.#db.wallets.has(walletId)) {
      throw postgresError(
        "23503",
        undefined,
        `ledger entry names unknown wallet ${walletId}`,
      );
    }

    const previous = this.#db.balances.get(walletId) ?? 0;
    const next = previous + delta;

    if (next < 0) {
      throw postgresError(
        "23514",
        "wallet_balances_never_negative",
        `wallet ${walletId} would fall to ${next} cents`,
      );
    }

    this.#db.balances.set(walletId, next);
    this.#undo.push(() => this.#db.balances.set(walletId, previous));
  }

  async #openHold(row: Record<string, unknown>, amount: number): Promise<void> {
    const holdId = requireId(optional(row.hold_id));
    await this.#lock(`hold:${holdId}`);

    if (this.#db.holds.has(holdId)) {
      throw postgresError(
        "23505",
        "hold_balances_pkey",
        `hold ${holdId} already exists`,
      );
    }

    this.#db.holds.set(holdId, {
      holdId,
      walletId: requireId(optional(row.wallet_id)),
      sessionId: requireId(optional(row.session_id)),
      participationId: requireId(optional(row.participation_id)),
      holdingAccountId: requireId(optional(row.holding_account_id)),
      originalCents: amount,
      heldCents: amount,
      settledKind: null,
    });
    this.#undo.push(() => this.#db.holds.delete(holdId));
  }

  async #settleHold(
    holdId: string,
    amount: number,
    kind: string,
  ): Promise<void> {
    await this.#lock(`hold:${holdId}`);

    const hold = this.#db.holds.get(holdId);
    if (
      hold === undefined ||
      hold.settledKind !== null ||
      hold.heldCents !== amount
    ) {
      throw postgresError(
        "23514",
        undefined,
        `${kind} of ${amount} cents does not match an open hold ${holdId}`,
      );
    }

    hold.heldCents = 0;
    hold.settledKind = kind;
    this.#undo.push(() => {
      hold.heldCents = amount;
      hold.settledKind = null;
    });
  }

  async #creditPayable(
    payoutId: string,
    sessionId: string,
    amount: number,
  ): Promise<void> {
    await this.#lock(`payable:${payoutId}`);

    const existing = this.#db.payables.get(payoutId);
    if (existing === undefined) {
      this.#db.payables.set(payoutId, {
        payoutId,
        sessionId,
        payableCents: amount,
        paidOutCents: 0,
      });
      this.#undo.push(() => this.#db.payables.delete(payoutId));
      return;
    }

    existing.payableCents += amount;
    this.#undo.push(() => {
      existing.payableCents -= amount;
    });
  }

  async #debitPayable(payoutId: string, amount: number): Promise<void> {
    await this.#lock(`payable:${payoutId}`);

    const payable = this.#db.payables.get(payoutId);
    if (payable === undefined) {
      throw postgresError(
        "23503",
        undefined,
        `payout ${payoutId} has nothing payable`,
      );
    }

    if (payable.payableCents - amount < 0) {
      throw postgresError(
        "23514",
        "payout_payables_never_negative",
        `payout ${payoutId} would fall below zero`,
      );
    }

    payable.payableCents -= amount;
    payable.paidOutCents += amount;
    this.#undo.push(() => {
      payable.payableCents += amount;
      payable.paidOutCents -= amount;
    });
  }
}

function readColumns(sql: string): readonly string[] {
  const match = /insert into ledger_entries \(([^)]+)\)/.exec(sql);
  if (match?.[1] === undefined) {
    throw new Error(`Could not read the column list from: ${sql}`);
  }
  return match[1].split(",").map((column) => column.trim());
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function requireId(value: string | undefined): string {
  if (value === undefined) throw new Error("A required reference was null");
  return value;
}
