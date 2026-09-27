import type {
  DeactivationInput,
  FinancialInstruction,
  GroupJoinResult,
  PayoutAttempt,
  PayoutRequestedIntent,
  RegularGroup,
  Session,
  UUID,
  User,
} from "@/domain";

/**
 * Loads and saves an aggregate root: User, Session, RegularGroup, or PayoutAttempt.
 * Owned children are part of their root's state and have no independent command
 * repository. Adapters choose the storage mapping and hydrate via constructors.
 * User reads include its Wallet with complete committed transaction history, a
 * ReliabilityScore calculated from that user's history, and memberships from a
 * consistent transaction view. Wallet.getAvailableBalance() derives spendable funds locally.
 * Reload after related writes; adapters must observe transaction writes and
 * protect concurrent funds. User saves persist owned state and wallet identity,
 * never rewrite ledger history or persist derived funds, scores, or memberships.
 * These are contracts for future adapters.
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
  readonly payouts: Repository<PayoutAttempt>;
  readonly deactivationInput: DeactivationInputPort;
  readonly ledger: LedgerWritePort;
  readonly payoutIntents: DurablePayoutIntentPort;
}

export interface UnitOfWorkRequest {
  readonly idempotencyKey: string;
  /** Identifies the operation, such as "UC2-05:withdraw". */
  readonly scope: string;
  /** Caller intent only; generated IDs and execution time are not request inputs. */
  readonly request: unknown;
}

/**
 * Commits repository changes, ledger writes, durable intents and the successful
 * result atomically. A rejected callback rolls all of them back, including its
 * idempotency claim, so a failed request can be retried with the same key.
 *
 * A successful key replays its original result without invoking work again.
 * Reusing it with a different scope or canonical request must be rejected;
 * object property order does not change request identity. Implementations must
 * include both scope and request when checking replay identity, and serialize
 * concurrent uses of the same key. Results must survive a JSON round trip.
 * Transaction reads observe earlier writes and isolate tentative domain objects
 * so a failed command cannot mutate committed state through an object alias.
 * Conflicting session or wallet changes must serialize or abort for a complete
 * transaction retry; different request keys must not allow overspending or
 * allocating the same capacity twice.
 * External API calls must never run inside work.
 */
export interface UnitOfWork {
  execute<T>(
    request: UnitOfWorkRequest,
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
