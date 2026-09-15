import { requireDomain } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface HoldingAccountDetails {
  readonly accountId: UUID;
}

/** Platform holding account identity, shared across sessions. Its balance is ledger-derived. */
export class HoldingAccount {
  readonly #accountId: UUID;
  constructor(details: HoldingAccountDetails) {
    requireDomain(
      typeof details.accountId === "string" && details.accountId.trim() !== "",
      "INVALID_INPUT",
      "accountId is required",
    );

    this.#accountId = details.accountId;
  }

  get accountId(): UUID {
    return this.#accountId;
  }
}
