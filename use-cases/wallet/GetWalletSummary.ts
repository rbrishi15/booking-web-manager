import { Money, type UUID } from "@/domain";
import type { WalletReader, WalletSummary } from "./contracts";
import { requireWalletId } from "./require-wallet";

/** UC1-05: resolve the owner's wallet and combine its balance and active holds. */
export class GetWalletSummary {
  constructor(private readonly reader: Pick<WalletReader,
    "findWalletIdByUserId" | "getWalletBalance" | "listActiveHolds">) {}

  async forUser(userId: UUID): Promise<WalletSummary> {
    const walletId = await requireWalletId(this.reader, userId);
    const balance = await this.reader.getWalletBalance(walletId);
    const holds = await this.reader.listActiveHolds(walletId);
    const held = holds.reduce((total, hold) => total.add(hold.heldAmount), Money.fromCents(0));
    return {
      walletId,
      userId,
      availableBalanceCents: balance?.availableBalance.toCents() ?? 0,
      heldBalanceCents: held.toCents(),
      currency: "SGD",
      activeHolds: holds.map((hold) => ({
        holdId: hold.holdId,
        sessionId: hold.sessionId,
        heldCents: hold.heldAmount.toCents(),
        originalCents: hold.originalAmount.toCents(),
        createdAt: hold.createdAt,
        venueName: hold.venueName,
        sport: hold.sport,
        startAt: hold.startAt,
      })),
    };
  }
}
