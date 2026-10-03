import type { Session, User, UUID } from "@/domain";
import type { LedgerWritePort } from "../shared/contracts";

/** Plain committed data can safely survive durable replay. */
export interface SessionCancellationResult {
  readonly sessionId: UUID;
  readonly status: "CANCELLED";
  readonly refundRecipientCount: number;
  readonly totalRefundCents: number;
}

export interface SessionCancellationRepositories {
  readonly users: { get(id: UUID): Promise<User | null> };
  readonly sessions: {
    get(id: UUID): Promise<Session | null>;
    saveCancellation(session: Session): Promise<void>;
  };
  readonly ledger: LedgerWritePort;
  /** Called only after current application access has been checked. */
  readonly submission: {
    once(bookerId: UUID, sessionId: UUID, previewVersion: string,
      work: () => Promise<SessionCancellationResult>): Promise<SessionCancellationResult>;
  };
}

/** Complete retries, replay data and financial state share one transaction. */
export interface SessionCancellationTransaction {
  run<T>(work: (repositories: SessionCancellationRepositories) => Promise<T>): Promise<T>;
}

export interface CancellationVersioner {
  of(session: Session): string;
}
