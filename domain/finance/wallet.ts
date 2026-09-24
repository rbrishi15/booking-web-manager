import { DomainError } from "../shared/errors";
import type { UUID } from "../shared/types";
import { LedgerTransaction } from "./ledger-transaction";
import { Money } from "./money";

export interface WalletDetails {
  readonly walletId: UUID;
  readonly userId: UUID;
  readonly transactions: readonly LedgerTransaction[];
}

/**
 * Immutable child owned by User. Holds the wallet's complete committed ledger
 * history and derives spendable funds from it. Ledger writes remain external;
 * reload the owning user after writes to obtain current transactions.
 */
export class Wallet {
  readonly #walletId: UUID;
  readonly #userId: UUID;
  readonly #transactions: readonly LedgerTransaction[];
  constructor(details: WalletDetails) {
    validate(details.walletId, "walletId");
    validate(details.userId, "userId");
    DomainError.require(
      Array.isArray(details.transactions),
      "INVALID_INPUT",
      "A wallet needs its complete transaction history",
    );
    const transactionIds = new Set<UUID>();
    for (const transaction of details.transactions) {
      DomainError.require(
        transaction.walletId === details.walletId,
        "INVALID_INPUT",
        "Wallet transactions must be ledger entries belonging to this wallet",
      );
      DomainError.require(
        !transactionIds.has(transaction.transactionId),
        "INVALID_INPUT",
        "Wallet transaction IDs must be unique",
      );
      transactionIds.add(transaction.transactionId);
    }

    this.#walletId = details.walletId;
    this.#userId = details.userId;
    this.#transactions = [...details.transactions];
    DomainError.require(
      this.getFunds().toCents() >= 0,
      "INVALID_INPUT",
      "Wallet funds cannot be negative",
    );
  }

  get walletId(): UUID {
    return this.#walletId;
  }
  get userId(): UUID {
    return this.#userId;
  }
  get transactions(): readonly LedgerTransaction[] {
    return [...this.#transactions];
  }

  /** Spendable funds only; held funds have already been debited by LOCK. */
  getFunds(): Money {
    // Sum with bigint so the result is exact and independent of history order,
    // even when lifetime credits exceed Money's safe integer range.
    let cents = 0n;
    for (const transaction of this.#transactions) {
      const amount = BigInt(transaction.amount.toCents());
      switch (transaction.kind) {
        case "TOP_UP":
        case "REFUND":
          cents += amount;
          break;
        case "LOCK":
        case "PAYOUT":
          cents -= amount;
          break;
        case "RELEASE":
        case "FORFEIT":
          break;
      }
    }
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    if (cents < -maximum || cents > maximum)
      throw new RangeError("Wallet funds overflowed safe integer cents");
    return Money.fromCents(Number(cents));
  }
}
function validate(value: string, name: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
