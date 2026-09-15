import type { HoldingAccountBalance } from "../read-models/holding-account-balance";
import type { WalletBalance } from "../read-models/wallet-balance";
import type { UUID } from "../types";

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
