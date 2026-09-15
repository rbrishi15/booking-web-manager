import { requireDomain } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface HoldingAccountSnapshot {
  readonly accountId: UUID;
}

/** Platform holding account identity, shared across sessions. Its balance is ledger-derived. */
export class HoldingAccount {
  readonly #snapshot: HoldingAccountSnapshot;
  private constructor(snapshot: HoldingAccountSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
  }
  static create(details: HoldingAccountSnapshot): HoldingAccount {
    requireDomain(
      typeof details.accountId === "string" && details.accountId.trim() !== "",
      "INVALID_INPUT",
      "accountId is required",
    );
    return new HoldingAccount(details);
  }
  static reconstitute(snapshot: HoldingAccountSnapshot): HoldingAccount {
    return HoldingAccount.create(snapshot);
  }
  snapshot(): HoldingAccountSnapshot {
    return { ...this.#snapshot };
  }
  get accountId(): UUID {
    return this.#snapshot.accountId;
  }
}
