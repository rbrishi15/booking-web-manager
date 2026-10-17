import type { UUID } from "@/domain";
import type { WalletReader, WalletTransactionsQuery, WalletTransactionsResult } from "./contracts";
import { requireWalletId } from "./require-wallet";

/** UC1-05: wallet ownership, bounded history and continuation stay together. */
export class ListWalletTransactions {
  constructor(private readonly reader: Pick<WalletReader,
    "findWalletIdByUserId" | "listWalletTransactions">) {}

  async forUser(userId: UUID, query: WalletTransactionsQuery): Promise<WalletTransactionsResult> {
    const walletId = await requireWalletId(this.reader, userId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const transactions = await this.reader.listWalletTransactions({
      walletId, limit, occurredBefore: query.before,
    });
    return {
      items: transactions.map((tx) => ({
        transactionId: tx.transactionId,
        kind: tx.kind,
        amountCents: tx.amount.toCents(),
        occurredAt: tx.occurredAt,
        idempotencyKey: tx.idempotencyKey,
        externalReference: tx.externalReference ?? null,
        holdId: tx.holdId ?? null,
        payoutId: tx.payoutId ?? null,
      })),
      nextCursor: transactions.length === limit ? transactions.at(-1)?.occurredAt ?? null : null,
    };
  }
}
