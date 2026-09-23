import type {
  DeactivationInput,
  FinancialInstruction,
  GroupJoinResult,
  Payout,
  PayoutRequestedIntent,
  RegularGroup,
  Session,
  UUID,
  User,
} from "@/domain";

/**
 * Loads and saves an aggregate root: User, Session, RegularGroup, or Payout.
 * Owned children are part of their root's state and have no independent command
 * repository. Adapters choose the storage mapping and hydrate via constructors.
 * User reads include wallet identity, ledger balance, a ReliabilityScore
 * calculated from that user's history, and memberships from a consistent
 * transaction view. Reload after related
 * writes; adapters must observe transaction writes and protect concurrent funds.
 * User saves persist owned state and wallet association, never loaded balance,
 * score, or membership projections. These are contracts for future adapters.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
 */
export interface Repository<T> {
  get(id: UUID): Promise<T | null>;
  save(aggregate: T): Promise<void>;
}

export interface DeactivationInputPort {
  get(userId: UUID): Promise<DeactivationInput>;
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

/** Coordinates changes across aggregate roots, ledger effects, and durable intents. */
export interface DomainTransaction {
  readonly users: Repository<User>;
  readonly sessions: Repository<Session>;
  readonly groups: Repository<RegularGroup>;
  readonly payouts: Repository<Payout>;
  readonly deactivationInput: DeactivationInputPort;
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

export type { DeactivationInput, GroupJoinResult };
