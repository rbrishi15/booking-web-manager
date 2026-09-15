import type { User } from "../../domain/accounts/user";
import type { Payout } from "../../domain/finance/payout";
import type {
  GroupJoinResult,
  RegularGroup,
} from "../../domain/groups/regular-group";
import type { Session } from "../../domain/sessions/session";
import type {
  AdmissionFacts,
  DeactivationFacts,
  FinancialInstruction,
  PayoutRequestedIntent,
} from "../../domain/shared/operations";
import type { UUID } from "../../domain/shared/types";

/** Repository ports are deliberately aggregate-oriented; adapters choose their persistence model. */
export interface Repository<T> {
  get(id: UUID): Promise<T | null>;
  save(aggregate: T): Promise<void>;
}

export interface AdmissionFactsPort {
  get(sessionId: UUID, userId: UUID): Promise<AdmissionFacts>;
}

export interface DeactivationFactsPort {
  get(userId: UUID): Promise<DeactivationFacts>;
}

/** Appends validated instructions to the committed ledger in the current transaction. */
export interface LedgerWritePort {
  append(instructions: readonly FinancialInstruction[]): Promise<void>;
}

/** Stores a durable intent; a dispatcher delivers it to the external payout provider later. */
export interface DurablePayoutIntentPort {
  append(intent: PayoutRequestedIntent): Promise<void>;
}

export type DurableIntentPort = DurablePayoutIntentPort;
export type LedgerWriter = LedgerWritePort;

export interface DomainTransaction {
  readonly users: Repository<User>;
  readonly sessions: Repository<Session>;
  readonly groups: Repository<RegularGroup>;
  readonly payouts: Repository<Payout>;
  readonly admissionFacts: AdmissionFactsPort;
  readonly deactivationFacts: DeactivationFactsPort;
  readonly ledger: LedgerWritePort;
  readonly payoutIntents: DurablePayoutIntentPort;
}

/** Implementations provide transaction rollback and idempotent replay semantics. */
export interface UnitOfWork {
  execute<T>(
    idempotencyKey: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  next(): UUID;
}

export type { AdmissionFacts, DeactivationFacts, GroupJoinResult };
