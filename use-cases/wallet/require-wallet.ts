import { DomainError, type UUID } from "@/domain";
import type { WalletReader } from "./contracts";

export async function requireWalletId(
  reader: Pick<WalletReader, "findWalletIdByUserId">,
  userId: UUID,
): Promise<UUID> {
  const walletId = await reader.findWalletIdByUserId(userId);
  if (walletId === null) throw new DomainError("NOT_FOUND", "Wallet was not found");
  return walletId;
}
