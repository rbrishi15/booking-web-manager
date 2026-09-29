import type { Session, User, UUID } from "@/domain";
import type {
  DomainTransaction,
  Repository,
  UnitOfWork,
} from "@/use-cases/shared/contracts";
import { vi } from "vitest";

/**
 * Creation-only transaction fake: stages new sessions and caches successful
 * results. It does not model concurrent transactions or updates to aggregates.
 */
export class CreateSessionUnitOfWork implements UnitOfWork {
  readonly sessions = new Map<UUID, Session>();
  readonly users: Map<UUID, User>;
  readonly replayResults = new Map<string, unknown>();
  readonly ledgerAppend = vi.fn(unsupported);
  readonly payoutIntentAppend = vi.fn(unsupported);
  failNextSave = false;

  constructor(users: readonly User[]) {
    this.users = new Map(users.map((user) => [user.userId, user]));
  }

  async execute<T>(
    key: string,
    work: (transaction: DomainTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.replayResults.has(key)) {
      // UnitOfWork binds the cached result type to the caller's operation key.
      return structuredClone(this.replayResults.get(key)) as T;
    }

    const staged = new Map<UUID, Session>();
    const result = await work({
      users: {
        get: async (id) => this.users.get(id) ?? null,
        save: unsupported,
      },
      sessions: {
        get: async (id) => staged.get(id) ?? this.sessions.get(id) ?? null,
        save: async (session) => {
          staged.set(session.sessionId, session);
          if (this.failNextSave) {
            this.failNextSave = false;
            throw new Error("Session save failed");
          }
        },
      },
      groups: unusedRepository(),
      payouts: unusedRepository(),
      deactivationInput: { get: unsupported },
      ledger: { append: this.ledgerAppend },
      payoutIntents: { append: this.payoutIntentAppend },
    });
    const replayResult = structuredClone(result);
    for (const [id, session] of staged) this.sessions.set(id, session);
    this.replayResults.set(key, replayResult);
    return result;
  }

  requireSession(id: UUID): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} was not committed`);
    return session;
  }
}

function unusedRepository<T>(): Repository<T> {
  return { get: unsupported, save: unsupported };
}

async function unsupported(): Promise<never> {
  throw new Error("Unexpected operation during session creation");
}
