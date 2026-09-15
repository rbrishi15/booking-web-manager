import type { UUID } from "../types";
import type { Money } from "../value-objects/money";

/** Ledger-derived total held across all sessions in the shared platform account. */
export interface HoldingAccountBalance {
  readonly accountId: UUID;
  readonly heldBalance: Money;
}
