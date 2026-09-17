import { isPostgresError, type PostgresErrorShape } from "./sql";

/**
 * Failures of the ledger itself.
 *
 * Input that is simply invalid keeps raising `DomainError` from `/domain`, so
 * there is one validation vocabulary across the codebase. `LedgerError` covers
 * what only the ledger can discover: a balance that would go negative, a hold
 * that is already settled, a replayed key, a lost race.
 */
export type LedgerErrorCode =
  /** A lock, release or forfeiture would drive a wallet below zero. */
  | "INSUFFICIENT_FUNDS"
  /** The hold named by a settlement is missing, already settled, or a different amount. */
  | "HOLD_NOT_OPEN"
  /** The entry already exists under this idempotency key. */
  | "DUPLICATE_ENTRY"
  /** Same idempotency key, different request body. A caller bug, not a retry. */
  | "IDEMPOTENCY_CONFLICT"
  /** An earlier attempt with this key is still running. */
  | "IDEMPOTENCY_IN_FLIGHT"
  /** A wallet, holding account or payout referenced by an entry does not exist. */
  | "UNKNOWN_ACCOUNT"
  /** The instruction cannot be expressed as a ledger entry. */
  | "INVALID_INSTRUCTION"
  /** Lost a race with a concurrent transaction; safe to retry. */
  | "SERIALISATION_FAILURE"
  /** Deadlocked with a concurrent transaction; safe to retry. */
  | "DEADLOCK"
  /** Stored data contradicts an invariant this layer guarantees. */
  | "INVARIANT_VIOLATED";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LedgerError";
  }
}

/** True when retrying the whole transaction is the correct response. */
export function isRetryable(error: unknown): boolean {
  return (
    error instanceof LedgerError &&
    (error.code === "SERIALISATION_FAILURE" || error.code === "DEADLOCK")
  );
}

const CONSTRAINT_CODES: Readonly<Record<string, LedgerErrorCode>> = {
  wallet_balances_never_negative: "INSUFFICIENT_FUNDS",
  hold_balances_never_negative: "INVARIANT_VIOLATED",
  hold_balances_never_exceeds_original: "INVARIANT_VIOLATED",
  hold_balances_settled_all_or_nothing: "HOLD_NOT_OPEN",
  hold_balances_pkey: "DUPLICATE_ENTRY",
  payout_payables_never_negative: "INVARIANT_VIOLATED",
  ledger_entries_idempotency_key_uidx: "DUPLICATE_ENTRY",
  ledger_entries_references_match_kind: "INVALID_INSTRUCTION",
  ledger_entries_amount_positive: "INVALID_INSTRUCTION",
  idempotency_keys_pkey: "DUPLICATE_ENTRY",
};

const SQLSTATE_CODES: Readonly<Record<string, LedgerErrorCode>> = {
  "40001": "SERIALISATION_FAILURE",
  "40P01": "DEADLOCK",
  "23503": "UNKNOWN_ACCOUNT",
};

/**
 * Turns a driver error into a `LedgerError` where the cause is known, and
 * returns null otherwise so the original error propagates unchanged. Losing the
 * real error behind a generic wrapper would cost more than it saves.
 */
export function translateDatabaseError(error: unknown): LedgerError | null {
  if (!isPostgresError(error)) return null;

  const byConstraint = error.constraint
    ? CONSTRAINT_CODES[error.constraint]
    : undefined;
  if (byConstraint) {
    return new LedgerError(byConstraint, describe(byConstraint, error), {
      cause: error,
    });
  }

  const bySqlState = error.code ? SQLSTATE_CODES[error.code] : undefined;
  if (bySqlState) {
    return new LedgerError(bySqlState, describe(bySqlState, error), {
      cause: error,
    });
  }

  // The apply trigger raises check_violation for a settlement that matches no
  // open hold. It names no constraint, so it is identified by its message.
  if (error.code === "23514" && /does not match an open hold/.test(error.message ?? "")) {
    return new LedgerError("HOLD_NOT_OPEN", error.message ?? "Hold is not open", {
      cause: error,
    });
  }

  if (error.code === "23514" && /append-only/.test(error.message ?? "")) {
    return new LedgerError(
      "INVARIANT_VIOLATED",
      error.message ?? "ledger_entries is append-only",
      { cause: error },
    );
  }

  return null;
}

/** Rethrows a driver error as a `LedgerError` when it can be identified. */
export function rethrowDatabaseError(error: unknown): never {
  throw translateDatabaseError(error) ?? error;
}

function describe(code: LedgerErrorCode, error: PostgresErrorShape): string {
  switch (code) {
    case "INSUFFICIENT_FUNDS":
      return "The wallet does not hold enough available funds";
    case "HOLD_NOT_OPEN":
      return "The hold is missing, already settled, or a different amount";
    case "DUPLICATE_ENTRY":
      return "This idempotency key has already produced a ledger entry";
    case "UNKNOWN_ACCOUNT":
      return "The entry references an account that does not exist";
    case "INVALID_INSTRUCTION":
      return "The instruction is not a well-formed ledger entry";
    case "SERIALISATION_FAILURE":
      return "The transaction lost a race and should be retried";
    case "DEADLOCK":
      return "The transaction deadlocked and should be retried";
    default:
      return error.message ?? "The ledger violated an invariant";
  }
}
