import {
  LedgerTransaction,
  Session,
  User,
  Wallet,
  type FinancialInstruction,
  type UUID,
} from "@/domain";
import { LedgerError } from "@/lib/money/errors";
import type {
  DomainTransaction,
  Repository,
  UnitOfWork,
  UnitOfWorkRequest,
} from "@/use-cases/shared/contracts";

interface TestUnitOfWorkSeed {
  readonly users?: readonly User[];
  readonly sessions?: readonly Session[];
}

interface HeldShare {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  readonly holdingAccountId: UUID;
  readonly walletId: UUID;
  readonly amountCents: number;
  readonly settled: boolean;
}

interface SavedResult {
  readonly fingerprint: string;
  readonly json: string;
}

/**
 * Test-only transaction adapter for use-case acceptance tests. Each transaction
 * stages detached roots and ledger projections, then installs them together.
 * Requests run sequentially in this process; this does not model database locks
 * or establish production concurrency guarantees.
 *
 * Seed wallet balances describe funds currently available. Starting session
 * holds provide settlement history without inventing extra wallet debits.
 */
export class TestUnitOfWork implements UnitOfWork {
  #users = new Map<UUID, User>();
  #sessions = new Map<UUID, Session>();
  #holds = new Map<UUID, HeldShare>();
  #instructions: FinancialInstruction[] = [];
  readonly #results = new Map<string, SavedResult>();
  readonly #appendFailures = new Map<number, Error>();
  #sessionSaveFailure?: Error;
  #appendAttempts = 0;
  #workCalls = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor({ users = [], sessions = [] }: TestUnitOfWorkSeed = {}) {
    const walletIds = new Set<UUID>();
    for (const user of users) {
      if (this.#users.has(user.userId) || walletIds.has(user.wallet.walletId))
        throw new Error("Test seed repeats a user or wallet identity");
      this.#users.set(user.userId, copyUser(user));
      walletIds.add(user.wallet.walletId);
    }
    for (const session of sessions) {
      if (this.#sessions.has(session.sessionId))
        throw new Error("Test seed repeats a session identity");
      this.#sessions.set(session.sessionId, copySession(session));
      for (const participation of session.participantList.participations) {
        const hold = participation.hold;
        if (hold === undefined) continue;
        if (this.#holds.has(hold.holdId))
          throw new Error("Test seed repeats a hold identity");
        this.#holds.set(hold.holdId, {
          sessionId: session.sessionId,
          participationId: participation.participationId,
          holdingAccountId: hold.holdingAccountId,
          walletId: hold.walletId,
          amountCents: hold.amount.toCents(),
          settled: ["REFUNDED", "RELEASED", "FORFEITED"].includes(hold.state),
        });
      }
    }
  }

  get ledgerInstructions(): readonly FinancialInstruction[] {
    return this.#instructions.map(copyInstruction);
  }

  get workCalls(): number {
    return this.#workCalls;
  }

  readSession(id: UUID): Session | undefined {
    const session = this.#sessions.get(id);
    return session === undefined ? undefined : copySession(session);
  }

  readUser(id: UUID): User | undefined {
    const user = this.#users.get(id);
    return user === undefined ? undefined : copyUser(user);
  }

  failNextSessionSave(error: Error): void {
    this.#sessionSaveFailure = error;
  }

  /** Absolute append-call number, including earlier rolled-back attempts. */
  failLedgerAppendAt(callNumber: number, error: Error): void {
    if (!Number.isSafeInteger(callNumber) || callNumber <= this.#appendAttempts)
      throw new Error("Ledger failure must target a future append attempt");
    this.#appendFailures.set(callNumber, error);
  }

  async execute<T>(
    request: UnitOfWorkRequest,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    const key = request.idempotencyKey;
    const fingerprint = canonicalJson({
      scope: request.scope,
      request: request.request,
    });
    const execution = this.#pending.then(() =>
      this.executeIsolated(key, fingerprint, work),
    );
    this.#pending = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  private async executeIsolated<T>(
    key: string,
    fingerprint: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.#results.get(key);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint)
        throw new LedgerError(
          "IDEMPOTENCY_CONFLICT",
          "The key belongs to a different scope or request",
        );
      return decodeResult<T>(previous.json);
    }

    let users = new Map(
      [...this.#users].map(([id, user]) => [id, copyUser(user)]),
    );
    const sessions = new Map(
      [...this.#sessions].map(([id, session]) => [id, copySession(session)]),
    );
    let holds = new Map(this.#holds);
    const instructions: FinancialInstruction[] = [];
    const transaction: DomainTransaction = {
      users: {
        get: async (id) => {
          const user = users.get(id);
          return user === undefined ? null : copyUser(user);
        },
        save: async (user) => {
          const current = users.get(user.userId);
          if (
            current !== undefined &&
            current.wallet.walletId !== user.wallet.walletId
          )
            throw new Error("Saving a user cannot replace its wallet identity");
          users.set(
            user.userId,
            copyUser(user, current?.wallet ?? user.wallet),
          );
        },
      },
      sessions: {
        get: async (id) => {
          const session = sessions.get(id);
          return session === undefined ? null : copySession(session);
        },
        save: async (session) => {
          if (this.#sessionSaveFailure !== undefined) {
            const error = this.#sessionSaveFailure;
            this.#sessionSaveFailure = undefined;
            throw error;
          }
          sessions.set(session.sessionId, copySession(session));
        },
      },
      ledger: {
        append: async (batch) => {
          this.#appendAttempts += 1;
          const failure = this.#appendFailures.get(this.#appendAttempts);
          if (failure !== undefined) {
            this.#appendFailures.delete(this.#appendAttempts);
            throw failure;
          }
          const nextUsers = new Map(users);
          const nextHolds = new Map(holds);
          const additions: FinancialInstruction[] = [];
          for (const instruction of batch) {
            const user = [...nextUsers.values()].find(
              (candidate) => candidate.wallet.walletId === instruction.walletId,
            );
            if (user === undefined)
              throw new LedgerError(
                "UNKNOWN_ACCOUNT",
                "The instruction wallet was not seeded or saved",
              );
            if (
              instruction.kind === "LOCK" &&
              user.wallet.getAvailableBalance().toCents() <
                instruction.amount.toCents()
            )
              throw new LedgerError(
                "INSUFFICIENT_FUNDS",
                "A lock cannot make available funds negative",
              );
            applyHoldInstruction(nextHolds, instruction);
            const entry = new LedgerTransaction({
              transactionId: `test-ledger:${JSON.stringify([key, instructions.length + additions.length])}`,
              walletId: instruction.walletId,
              amount: instruction.amount,
              kind: instruction.kind,
              occurredAt: instruction.occurredAt,
              idempotencyKey: key,
              holdId: instruction.holdId,
              payoutId: instruction.payoutId,
            });
            const wallet = new Wallet({
              walletId: user.wallet.walletId,
              userId: user.userId,
              transactions: [...user.wallet.transactions, entry],
            });
            nextUsers.set(user.userId, copyUser(user, wallet));
            additions.push(copyInstruction(instruction));
          }
          users = nextUsers;
          holds = nextHolds;
          instructions.push(...additions);
        },
      },
      groups: unsupportedRepository("groups"),
      payouts: unsupportedRepository("payouts"),
      deactivationInput: { get: async () => unsupported("deactivation input") },
      payoutIntents: { append: async () => unsupported("payout intents") },
    };

    this.#workCalls += 1;
    const result = await work(transaction);
    const json = JSON.stringify({ result });
    const detachedResult = decodeResult<T>(json);
    this.#users = new Map(users);
    this.#sessions = new Map(sessions);
    this.#holds = new Map(holds);
    this.#instructions.push(...instructions);
    this.#results.set(key, { fingerprint, json });
    return detachedResult;
  }
}

function copyUser(user: User, wallet = user.wallet): User {
  return new User({
    userId: user.userId,
    email: user.email,
    accountStatus: user.accountStatus,
    preferredSports: user.preferredSports,
    preferredRegions: user.preferredRegions,
    payoutAccount: user.payoutAccount,
    reliabilityScore: user.reliabilityScore,
    memberGroupIds: user.memberGroupIds,
    wallet: new Wallet({
      walletId: wallet.walletId,
      userId: wallet.userId,
      transactions: wallet.transactions,
    }),
  });
}

function copySession(session: Session): Session {
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

function copyInstruction(
  instruction: FinancialInstruction,
): FinancialInstruction {
  return { ...instruction, occurredAt: new Date(instruction.occurredAt) };
}

function applyHoldInstruction(
  holds: Map<UUID, HeldShare>,
  instruction: FinancialInstruction,
): void {
  const existing = holds.get(instruction.holdId);
  if (instruction.kind === "LOCK") {
    if (existing !== undefined)
      throw new LedgerError("DUPLICATE_ENTRY", "The hold was already locked");
    holds.set(instruction.holdId, {
      sessionId: instruction.sessionId,
      participationId: instruction.participationId,
      holdingAccountId: instruction.holdingAccountId,
      walletId: instruction.walletId,
      amountCents: instruction.amount.toCents(),
      settled: false,
    });
    return;
  }
  if (
    existing === undefined ||
    existing.settled ||
    existing.sessionId !== instruction.sessionId ||
    existing.participationId !== instruction.participationId ||
    existing.holdingAccountId !== instruction.holdingAccountId ||
    existing.walletId !== instruction.walletId ||
    existing.amountCents !== instruction.amount.toCents()
  )
    throw new LedgerError(
      "HOLD_NOT_OPEN",
      "The instruction must settle one matching open hold",
    );
  holds.set(instruction.holdId, { ...existing, settled: true });
}

function unsupportedRepository<T>(name: string): Repository<T> {
  return {
    get: async () => unsupported(`${name} reads`),
    save: async () => unsupported(`${name} writes`),
  };
}

function unsupported(operation: string): never {
  throw new Error(`TestUnitOfWork does not support ${operation}`);
}

function decodeResult<T>(json: string): T {
  return JSON.parse(json).result;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(JSON.parse(JSON.stringify({ value }))));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  );
}
