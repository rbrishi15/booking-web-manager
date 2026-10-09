import type { UUID } from "@/domain";
import type {
  activeHoldSchema,
  walletSummarySchema,
  walletTransactionSchema,
  walletTransactionsResponseSchema,
  walletTopUpRequestSchema,
  walletTopUpResultSchema,
} from "./contracts";
import type { z } from "@/app/openapi/contracts";

export type ActiveHoldItem = z.infer<typeof activeHoldSchema>;
export type WalletSummary = z.infer<typeof walletSummarySchema>;
export type WalletTransactionItem = z.infer<typeof walletTransactionSchema>;
export type WalletTransactionsResult = z.infer<
  typeof walletTransactionsResponseSchema
>;
export type WalletTopUpRequest = z.infer<typeof walletTopUpRequestSchema>;
export type WalletTopUpResult = z.infer<typeof walletTopUpResultSchema>;

export interface WalletApiDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly getWalletSummary: (userId: UUID) => Promise<WalletSummary>;
  readonly listTransactions: (
    userId: UUID,
    query: { limit?: number; before?: Date },
  ) => Promise<WalletTransactionsResult>;
  readonly createTopUpIntent: (
    userId: UUID,
    input: WalletTopUpRequest,
  ) => Promise<WalletTopUpResult>;
}
