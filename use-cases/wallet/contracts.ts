import type { LedgerTransaction, Money, TransactionKind, UUID, WalletBalance } from "@/domain";

export interface WalletHistoryQuery {
  readonly walletId: UUID;
  readonly limit?: number;
  readonly occurredBefore?: Date;
}

export interface WalletHistoryReadPort {
  listWalletTransactions(query: WalletHistoryQuery): Promise<readonly LedgerTransaction[]>;
}

export interface ActiveWalletHold {
  readonly holdId: UUID;
  readonly sessionId: UUID;
  readonly heldAmount: Money;
  readonly originalAmount: Money;
  readonly createdAt: Date;
  readonly venueName?: string;
  readonly sport?: string;
  readonly startAt?: Date;
}

/** Read projections only; this interface cannot credit or mutate a wallet. */
export interface WalletReader extends WalletHistoryReadPort {
  findWalletIdByUserId(userId: UUID): Promise<UUID | null>;
  getWalletBalance(walletId: UUID): Promise<WalletBalance | null>;
  listActiveHolds(walletId: UUID): Promise<readonly ActiveWalletHold[]>;
}

export interface WalletSummary {
  readonly walletId: UUID;
  readonly userId: UUID;
  readonly availableBalanceCents: number;
  readonly heldBalanceCents: number;
  readonly currency: "SGD";
  readonly activeHolds: readonly {
    readonly holdId: UUID;
    readonly sessionId: UUID;
    readonly heldCents: number;
    readonly originalCents: number;
    readonly createdAt: Date;
    readonly venueName?: string;
    readonly sport?: string;
    readonly startAt?: Date;
  }[];
}

export interface WalletTransactionsQuery {
  readonly limit?: number;
  readonly before?: Date;
}

export interface WalletTransactionsResult {
  readonly items: readonly {
    readonly transactionId: UUID;
    readonly kind: TransactionKind;
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly idempotencyKey: string;
    readonly externalReference: string | null;
    readonly holdId: UUID | null;
    readonly payoutId: UUID | null;
  }[];
  readonly nextCursor: Date | null;
}

export interface WalletTopUpRequest {
  readonly amountCents: number;
  readonly idempotencyKey: string;
}

export interface WalletTopUpResult {
  readonly paymentIntentId: string;
  readonly clientSecret: string;
  readonly amountCents: number;
  readonly currency: "SGD";
  readonly status: string;
}

/** Creates a payment request only. Verified webhook processing owns crediting. */
export interface WalletTopUpProvider {
  createIntent(request: WalletTopUpRequest & {
    readonly userId: UUID;
    readonly walletId: UUID;
  }): Promise<WalletTopUpResult>;
}
