import type { AccountStatus } from "./statuses";
import type { UUID } from "./types";
import type { Money } from "./value-objects/money";
import type { ReliabilityScore } from "./value-objects/reliability-score";

/** Loaded by the application in the transaction, never accepted from a client DTO. */
export interface AdmissionFacts {
  readonly userId: UUID;
  readonly walletId: UUID;
  readonly accountStatus: AccountStatus;
  /** Derived reliability supplied by the application. `reliabilityScore` is a compatibility alias. */
  readonly score?: ReliabilityScore;
  readonly reliabilityScore?: ReliabilityScore;
  readonly availableBalance: Money;
  readonly memberGroupIds: readonly UUID[];
}

export interface DeactivationFacts {
  readonly availableBalance: Money;
  readonly heldBalance: Money;
  readonly activeCommitments: number;
  readonly unsettledOwnedSessions: number;
  readonly pendingPayouts: number;
  readonly activeOwnedGroups: number;
}

export interface PayoutDestination {
  readonly payoutAccountId: UUID;
  readonly userId: UUID;
  readonly providerAccountReference: string;
  readonly bankAccountReference: string;
}

export interface SettlementLine {
  readonly holdId: UUID;
  readonly participationId: UUID;
  readonly holdingAccountId: UUID;
  readonly walletId: UUID;
  readonly amount: Money;
  readonly kind: "RELEASE" | "FORFEIT";
}

export interface SettlementBatch {
  readonly payoutId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
  readonly destination: PayoutDestination;
  readonly lines: readonly SettlementLine[];
}

/** LOCK debits the origin wallet; REFUND credits it. RELEASE/FORFEIT pay externally. */
export interface FinancialInstruction {
  readonly kind: "LOCK" | "REFUND" | "RELEASE" | "FORFEIT";
  readonly sessionId: UUID;
  readonly participationId: UUID;
  readonly holdId: UUID;
  readonly holdingAccountId: UUID;
  readonly walletId: UUID;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly payoutId?: UUID;
}

export interface FinancialResult {
  readonly instructions: readonly FinancialInstruction[];
}

export interface AdmissionResult extends FinancialResult {
  readonly kind: "COMMITTED" | "WAITLISTED";
  readonly participationId: UUID;
  readonly refundedParticipationId?: UUID;
}

export interface PromotionResult extends FinancialResult {
  readonly kind: "PROMOTED" | "SKIPPED" | "NONE";
  readonly participationId?: UUID;
  readonly reason?:
    | "INACTIVE_ACCOUNT"
    | "LOW_RELIABILITY"
    | "INSUFFICIENT_FUNDS";
  readonly refundedParticipationId?: UUID;
}

export interface WithdrawalResult extends FinancialResult {
  readonly kind: "REFUNDED" | "AWAITING_REPLACEMENT";
  readonly participationId: UUID;
}

export interface PayoutRequestedIntent {
  readonly kind: "PAYOUT_REQUESTED";
  readonly payoutId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
  readonly amount: Money;
  readonly destination: PayoutDestination;
  readonly requestedAt: Date;
}
