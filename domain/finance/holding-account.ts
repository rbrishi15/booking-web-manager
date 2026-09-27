import { DomainError } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface HoldingAccountDetails {
  readonly accountId: UUID;
}

/**
 * Immutable platform account identity shared across sessions, not an aggregate root.
 * Its balance is ledger-derived. FundHold children belong to their Session
 * aggregate through Participation, rather than to this account object.
 */
export class HoldingAccount {
  readonly #accountId: UUID;
  constructor(details: HoldingAccountDetails) {
    DomainError.require(
      details.accountId.trim() !== "",
      "INVALID_INPUT",
      "accountId is required",
    );

    this.#accountId = details.accountId;
  }

  get accountId(): UUID {
    return this.#accountId;
  }
}
