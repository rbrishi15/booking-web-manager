import type { Session, User, UUID } from "@/domain";
import type { Repository } from "../shared/contracts";

/** Complete aggregates; implementations lock a session loaded for mutation. */
export interface SessionManagementRepositories {
  readonly users: Pick<Repository<User>, "get">;
  readonly sessions: {
    get(sessionId: UUID): Promise<Session | null>;
    /** All owned OPEN sessions strictly after now, ordered by start time and ID. */
    listUpcoming(bookerId: UUID, now: Date): Promise<readonly Session[]>;
    /** Persists visibility only, preserving all other aggregate state. */
    saveVisibility(session: Session): Promise<void>;
  };
}

/** Mutation adapters retry the entire serializable transaction, never only its writes. */
export interface SessionManagementTransaction {
  run<T>(work: (repositories: SessionManagementRepositories) => Promise<T>): Promise<T>;
}
