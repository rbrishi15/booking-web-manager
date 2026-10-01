import type { UUID } from "@/domain";
import type { DomainTransaction } from "../shared/contracts";

export interface SessionCreationRepositories {
  readonly users: Pick<DomainTransaction["users"], "get">;
  readonly sessions: Pick<DomainTransaction["sessions"], "save">;
}

/**
 * An atomic creation transaction scoped to one logical submission. Its adapter
 * owns request identity and returns the original result when that submission
 * is retried for the same booker, including across separately constructed instances.
 */
export interface SessionCreationTransaction {
  runForBooker<T>(
    bookerId: UUID,
    work: (repositories: SessionCreationRepositories) => Promise<T>,
  ): Promise<T>;
}
