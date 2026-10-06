import {
  type FinancialInstruction,
  LedgerTransaction,
  Session,
  User,
  type UserDetails,
  type UUID,
  Wallet,
} from "@/domain";
import type {
  DomainTransaction,
  Repository,
  UnitOfWork,
} from "@/use-cases/shared/contracts";

/**
 * Transactional test double for commitment use cases.
 *
 * - Each transaction hydrates fresh User and Session objects, as a database
 *   adapter would, so a failed transaction cannot leak in-memory mutations.
 * - Users' wallets include every committed ledger instruction for that wallet,
 *   so available funds fall after a LOCK and rise after a REFUND.
 * - Writes are staged and applied only when the work succeeds. Successful
 *   results are cached by key; failures are not, so they stay retryable.
 * - Transactions run one at a time. This stands in for the session row lock
 *   (`SELECT ... FOR UPDATE`) the Postgres adapter must take; it proves the
 *   coordinator reads and writes inside its transaction, not that the
 *   production adapter serializes correctly.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  readonly ledgerInstructions: FinancialInstruction[] = [];
  failNextLedgerAppend = false;
  readonly #users = new Map<UUID, UserDetails>();
  readonly #sessions = new Map<UUID, Session>();
  readonly #replayResults = new Map<string, unknown>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: {
    users: readonly UserDetails[];
    sessions: readonly Session[];
  }) {
    for (const user of options.users) this.#users.set(user.userId, user);
    for (const session of options.sessions)
      this.#sessions.set(session.sessionId, cloneSession(session));
  }

  execute<T>(
    key: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.#queue.then(() => this.#run(key, work));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** The committed session state, as a fresh copy. */
  requireSession(sessionId: UUID): Session {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} was not committed`);
    return cloneSession(session);
  }

  /** The user's committed available funds in cents. */
  availableCents(userId: UUID): number {
    const user = this.#loadUser(userId, []);
    if (!user) throw new Error(`User ${userId} does not exist`);
    return user.wallet.getAvailableBalance().toCents();
  }

  async #run<T>(
    key: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.#replayResults.has(key)) {
      // UnitOfWork binds the cached result type to the caller's operation key.
      return structuredClone(this.#replayResults.get(key)) as T;
    }

    const stagedSessions = new Map<UUID, Session>();
    const stagedInstructions: FinancialInstruction[] = [];
    const result = await work({
      users: {
        get: async (id) => this.#loadUser(id, stagedInstructions),
        save: unsupported,
      },
      sessions: {
        get: async (id) => {
          const session = stagedSessions.get(id) ?? this.#sessions.get(id);
          return session === undefined ? null : cloneSession(session);
        },
        save: async (session) => {
          stagedSessions.set(session.sessionId, cloneSession(session));
        },
      },
      groups: unusedRepository(),
      payouts: unusedRepository(),
      deactivationInput: { get: unsupported },
      ledger: {
        append: async (instructions) => {
          if (this.failNextLedgerAppend) {
            this.failNextLedgerAppend = false;
            throw new Error("Ledger append failed");
          }
          stagedInstructions.push(...instructions);
        },
      },
      payoutIntents: { append: unsupported },
    });

    const replayResult = structuredClone(result);
    for (const [id, session] of stagedSessions) this.#sessions.set(id, session);
    this.ledgerInstructions.push(...stagedInstructions);
    this.#replayResults.set(key, replayResult);
    return result;
  }

  #loadUser(
    userId: UUID,
    staged: readonly FinancialInstruction[],
  ): User | null {
    const details = this.#users.get(userId);
    if (details === undefined) return null;
    const { wallet } = details;
    const movements = [...this.ledgerInstructions, ...staged]
      .filter((instruction) => instruction.walletId === wallet.walletId)
      .map(
        (instruction) =>
          new LedgerTransaction({
            transactionId: `${instruction.kind}-${instruction.holdId}`,
            walletId: instruction.walletId,
            holdId: instruction.holdId,
            amount: instruction.amount,
            kind: instruction.kind,
            occurredAt: instruction.occurredAt,
            idempotencyKey: `${instruction.kind}-${instruction.holdId}`,
          }),
      );
    return new User({
      ...details,
      wallet: new Wallet({
        walletId: wallet.walletId,
        userId: wallet.userId,
        transactions: [...wallet.transactions, ...movements],
      }),
    });
  }
}

/** Re-hydrates a session through its public constructor, as an adapter would. */
function cloneSession(session: Session): Session {
  return new Session({
    sessionId: session.sessionId,
    bookerId: session.bookerId,
    invitedGroupId: session.invitedGroupId,
    booking: session.booking,
    totalSlots: session.totalSlots,
    minimumHeadcount: session.minimumHeadcount,
    visibility: session.visibility,
    status: session.status,
    minimumReliability: session.minimumReliability,
    roomToken: session.roomToken,
    holdingAccountId: session.holdingAccountId,
    participations: session.participantList.participations,
    nextQueueSequence: session.participantList.nextQueueSequence,
    pendingSettlement: session.pendingSettlement,
    payoutAttemptIds: session.payoutAttemptIds,
    payoutIdempotencyKeys: session.payoutIdempotencyKeys,
  });
}

function unusedRepository<T>(): Repository<T> {
  return { get: unsupported, save: unsupported };
}

async function unsupported(): Promise<never> {
  throw new Error("Unexpected operation in a commitment use case");
}
