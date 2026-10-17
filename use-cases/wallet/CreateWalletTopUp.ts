import type { UUID } from "@/domain";
import type { WalletReader, WalletTopUpProvider, WalletTopUpRequest, WalletTopUpResult } from "./contracts";
import { requireWalletId } from "./require-wallet";

/** UC1-05: bind a payment request to the authenticated owner's stored wallet. */
export class CreateWalletTopUp {
  constructor(
    private readonly reader: Pick<WalletReader, "findWalletIdByUserId">,
    private readonly provider: WalletTopUpProvider,
  ) {}

  async forUser(userId: UUID, input: WalletTopUpRequest): Promise<WalletTopUpResult> {
    const walletId = await requireWalletId(this.reader, userId);
    return this.provider.createIntent({
      userId, walletId, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey,
    });
  }
}
