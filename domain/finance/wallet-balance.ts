import type { UUID } from "../shared/types";
import type { Money } from "./money";

/** Derived exclusively from committed ledger entries, never a writable balance. */
export interface WalletBalance {
  readonly walletId: UUID;
  readonly availableBalance: Money;
}
