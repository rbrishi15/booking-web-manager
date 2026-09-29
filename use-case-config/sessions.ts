import {
  handleCreateSession,
  type CreateSessionHttpDependencies,
} from "@/app/sessions/create-session-handler";
import type { UUID } from "@/domain";
import { RequestSessionCreationTransaction } from "@/lib/sessions/request-session-creation-transaction";
import { CreateSessions } from "@/use-cases/sessions/CreateSessions";
import type { UseCaseDependencies } from "@/use-cases/shared/dependencies";

export interface SessionHandlerDependencies extends UseCaseDependencies {
  readonly authenticate: CreateSessionHttpDependencies["authenticate"];
  readonly holdingAccountId: UUID;
}

/** Connect the server dependencies once; create submission-scoped objects per request. */
export function createSessionHandler(
  dependencies: SessionHandlerDependencies,
): (request: Request) => Promise<Response> {
  const { authenticate, unitOfWork, clock, ids, holdingAccountId } = dependencies;
  const httpDependencies: CreateSessionHttpDependencies = {
    authenticate,
    createForSubmission: (submission) =>
      new CreateSessions({
        transaction: new RequestSessionCreationTransaction(unitOfWork, submission),
        clock,
        ids,
        holdingAccountId,
      }),
  };

  return (request) => handleCreateSession(request, httpDependencies);
}
