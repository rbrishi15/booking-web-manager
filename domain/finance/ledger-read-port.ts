import type { UUID } from "../shared/types";
import type { HoldingAccountBalance } from "./holding-account-balance";
import type { WalletBalance } from "./wallet-balance";

/**
 * Implemented by the server's ledger adapter using committed, append-only entries.
 * Return null for an unknown account, and Money.fromCents(0) for an existing
 * account without entries. Reads must observe a consistent committed state.
 */
export interface LedgerReadPort {
  getWalletBalance(walletId: UUID): Promise<WalletBalance | null>;
  getHoldingAccountBalance(
    accountId: UUID,
  ): Promise<HoldingAccountBalance | null>;
}
