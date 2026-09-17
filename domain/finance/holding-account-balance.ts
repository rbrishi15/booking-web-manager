import type { UUID } from "../shared/types";
import type { Money } from "./money";

/** Ledger-derived total held across all sessions in the shared platform account. */
export interface HoldingAccountBalance {
  readonly accountId: UUID;
  readonly heldBalance: Money;
}
