import type { UUID } from "@/domain";
import type { SessionCreationSubmission } from "@/lib/sessions/request-session-creation-transaction";
import type { CreateSessions } from "@/use-cases/sessions/CreateSessions";

/** Capabilities the HTTP route needs after server dependencies are assembled. */
export interface SessionApiDependencies {
  /**
   * Verify the request and current ACTIVE account before creation or replay.
   * Return null for missing/invalid credentials. Reject inactive accounts with
   * INACTIVE_ACCOUNT and missing accounts with NOT_FOUND DomainErrors.
   * Provider failures must throw.
   * This capability is invoked afresh for every HTTP request.
   */
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly createForSubmission: (
    submission: SessionCreationSubmission,
  ) => Pick<CreateSessions, "forBooker">;
}
