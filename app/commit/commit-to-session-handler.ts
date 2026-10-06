import type { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { parseCommitToSessionInput } from "./commit-to-session-input";
import { type Authenticate, handleAuthenticatedJson } from "./http";

export interface CommitToSessionHttpDependencies {
  readonly authenticate: Authenticate;
  readonly commitToSession: Pick<CommitToSession, "forParticipant">;
}

/**
 * HTTP boundary for UC2-04 Commit to Session. Authenticates, validates the
 * body with Zod, and delegates to CommitToSession. The fund lock and the
 * commitment are written in one unit of work inside the use case, keyed by
 * the required idempotency key; this handler performs no writes itself.
 */
export function handleCommitToSession(
  request: Request,
  dependencies: CommitToSessionHttpDependencies,
): Promise<Response> {
  return handleAuthenticatedJson(request, {
    authenticate: dependencies.authenticate,
    parse: parseCommitToSessionInput,
    run: (input) => dependencies.commitToSession.forParticipant(input),
    successStatus: 201,
    invalidRequestMessage: "Invalid commitment request",
  });
}
