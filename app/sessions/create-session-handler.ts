import { DomainError, type UUID } from "@/domain";
import type { SessionCreationSubmission } from "@/lib/sessions/request-session-creation-transaction";
import type { CreateSessions } from "@/use-cases/sessions/CreateSessions";
import { z } from "zod";
import { parseCreateSessionInput } from "./create-session-input";

export interface CreateSessionHttpDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly createForSubmission: (
    submission: SessionCreationSubmission,
  ) => Pick<CreateSessions, "forBooker">;
}

const authenticatedUserId = z.string().uuid();
const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 422,
  INACTIVE_ACCOUNT: 403,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  PAYOUT_ACCOUNT_NOT_READY: 409,
  SESSION_STARTED: 409,
};

/** Authenticates and parses one HTTP submission before entering UC2-02. */
export async function handleCreateSession(
  request: Request,
  dependencies: CreateSessionHttpDependencies,
): Promise<Response> {
  let bookerId: UUID;
  try {
    const identity = await dependencies.authenticate(request);
    if (identity === null) {
      return errorResponse(401, "UNAUTHENTICATED", "Authentication is required");
    }
    bookerId = authenticatedUserId.parse(identity);
  } catch {
    return internalErrorResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return error instanceof SyntaxError
      ? errorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON")
      : internalErrorResponse();
  }

  let parsed: ReturnType<typeof parseCreateSessionInput>;
  try {
    parsed = parseCreateSessionInput(bookerId, body);
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(400, "INVALID_REQUEST", "Invalid session creation request")
      : internalErrorResponse();
  }

  try {
    const { input, submission } = parsed;
    const sessions = dependencies.createForSubmission(submission);
    const result = await sessions.forBooker(
      input.bookerId,
      input.booking,
      input.config,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DomainError) {
      const status = domainErrorStatuses[error.code];
      if (status !== undefined) {
        return errorResponse(status, error.code, error.message);
      }
    }
    return internalErrorResponse();
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function internalErrorResponse(): Response {
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
}
