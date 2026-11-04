import type { Session, User, UUID } from "@/domain";
import type { Repository } from "../shared/contracts";

export interface SessionEditingRepositories {
  readonly users: Pick<Repository<User>, "get">;
  readonly sessions: {
    get(sessionId: UUID): Promise<Session | null>;
    saveDetails(session: Session): Promise<void>;
  };
}

/** Reads and saves share a serializable transaction and the session parent-row lock. */
export interface SessionEditingTransaction {
  run<T>(work: (repositories: SessionEditingRepositories) => Promise<T>): Promise<T>;
}

export interface SessionEditingVersioner {
  of(session: Session): string;
}
