import { requireDomain } from "../errors";
import type { UUID } from "../types";

export interface HoldingAccountSnapshot {
  readonly accountId: UUID;
}

/** Platform holding account identity, shared across sessions. Its balance is ledger-derived. */
export class HoldingAccount {
  readonly #snapshot: HoldingAccountSnapshot;
  private constructor(snapshot: HoldingAccountSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
  }
  static create(props: HoldingAccountSnapshot): HoldingAccount {
    requireDomain(
      typeof props.accountId === "string" && props.accountId.trim() !== "",
      "INVALID_INPUT",
      "accountId is required",
    );
    return new HoldingAccount(props);
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
export type HoldingAccountProps = HoldingAccountSnapshot;
