import type { GetWalletSummary } from "@/use-cases/wallet/GetWalletSummary";
import type { ListWalletTransactions } from "@/use-cases/wallet/ListWalletTransactions";
import type { WalletSummary, WalletTransactionsResult } from "./dependencies";

/** Dates remain application values until the HTTP response is serialized. */
export function serializeWalletSummary(
  summary: Awaited<ReturnType<GetWalletSummary["forUser"]>>,
): WalletSummary {
  return {
    ...summary,
    activeHolds: summary.activeHolds.map((hold) => ({
      ...hold,
      createdAt: hold.createdAt.toISOString(),
      startAt: hold.startAt?.toISOString(),
    })),
  };
}

export function serializeWalletTransactions(
  page: Awaited<ReturnType<ListWalletTransactions["forUser"]>>,
): WalletTransactionsResult {
  return {
    items: page.items.map((transaction) => ({
      ...transaction,
      occurredAt: transaction.occurredAt.toISOString(),
    })),
    nextCursor: page.nextCursor?.toISOString() ?? null,
  };
}
