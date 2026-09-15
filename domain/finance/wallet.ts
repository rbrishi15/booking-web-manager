import { requireDomain } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface WalletDetails {
  readonly walletId: UUID;
  readonly userId: UUID;
}

/** Wallet identity. Balances are projections of the append-only ledger. */
export class Wallet {
  readonly #walletId: UUID;
  readonly #userId: UUID;
  constructor(details: WalletDetails) {
    validate(details.walletId, "walletId");
    validate(details.userId, "userId");

    this.#walletId = details.walletId;
    this.#userId = details.userId;
  }

  get walletId(): UUID {
    return this.#walletId;
  }
  get userId(): UUID {
    return this.#userId;
  }
}
function validate(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
