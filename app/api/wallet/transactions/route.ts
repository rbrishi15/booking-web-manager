import { walletQueryAction } from "@/app/wallet/wallet-action";
import { parseTransactionQueryInput } from "@/app/wallet/transaction-query-input";

export const runtime = "nodejs";

/** UC1-05: list append-only ledger transactions for the authenticated user. */
export const GET = walletQueryAction({
  parse: parseTransactionQueryInput,
  run: (dependencies, input) =>
    dependencies.listTransactions(input.userId, input.query),
  invalidRequestMessage: "Invalid transaction query",
});
