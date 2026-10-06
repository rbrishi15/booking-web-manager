import type { Session, User, UUID } from "@/domain";
import type { LedgerWritePort } from "../shared/contracts";

export interface SessionParticipantRemovalResult {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  readonly status: "REMOVED";
  readonly refundCents: number;
}

export interface SessionRemovalReadRepositories {
  readonly users: { get(id: UUID): Promise<User | null> };
  readonly sessions: { get(id: UUID): Promise<Session | null> };
  readonly participants: { displayNames(userIds: readonly UUID[]): Promise<ReadonlyMap<UUID, string>> };
}

/** All display and preview facts share the complete aggregate's transaction. */
export interface SessionRemovalReadTransaction {
  run<T>(work: (repositories: SessionRemovalReadRepositories) => Promise<T>): Promise<T>;
}

export interface SessionRemovalRepositories {
  readonly users: { get(id: UUID): Promise<User | null> };
  readonly sessions: {
    get(id: UUID): Promise<Session | null>;
    saveRemoval(session: Session, participationId: UUID): Promise<void>;
  };
  readonly ledger: LedgerWritePort;
  /** Consulted only after current application access has been authorized. */
  readonly submission: {
    once(bookerId: UUID, sessionId: UUID, participationId: UUID, previewVersion: string,
      work: () => Promise<SessionParticipantRemovalResult>): Promise<SessionParticipantRemovalResult>;
  };
}

/** Refund, removal and durable replay commit together; retries restart all work. */
export interface SessionRemovalTransaction {
  run<T>(work: (repositories: SessionRemovalRepositories) => Promise<T>): Promise<T>;
}

export interface RemovalVersioner {
  of(session: Session, participationId: UUID): string;
}
