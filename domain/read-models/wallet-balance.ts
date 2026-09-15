import type { UUID } from "../types";
import type { Money } from "../value-objects/money";

/** Derived exclusively from committed ledger entries, never a writable balance. */
export interface WalletBalance {
  readonly walletId: UUID;
  readonly availableBalance: Money;
}
