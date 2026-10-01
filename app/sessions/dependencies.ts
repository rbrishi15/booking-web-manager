import type { UUID } from "@/domain";
import type { SessionCreationSubmission } from "@/lib/sessions/request-session-creation-transaction";
import type { CreateSessions } from "@/use-cases/sessions/CreateSessions";

/** Capabilities the HTTP route needs after server dependencies are assembled. */
export interface SessionApiDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly createForSubmission: (
    submission: SessionCreationSubmission,
  ) => Pick<CreateSessions, "forBooker">;
}
