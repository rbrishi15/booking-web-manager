import { DomainError, type UUID } from "@/domain";
import type { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { z } from "zod";
import { parseCommitToSessionInput } from "./commit-to-session-input";

export interface CommitToSessionHttpDependencies {
  /** Resolves the verified user ID for the request, or null when signed out. */
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly commitToSession: Pick<CommitToSession, "forParticipant">;
}

const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 422,
  UNAUTHORIZED: 403,
  INACTIVE_ACCOUNT: 403,
  INVALID_ACCESS: 403,
  LOW_RELIABILITY: 403,
  NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 409,
  ALREADY_PARTICIPATING: 409,
  REJOIN_NOT_ALLOWED: 409,
  INVALID_STATE: 409,
  CAPACITY_EXCEEDED: 409,
  SESSION_CLOSED: 409,
  SESSION_STARTED: 409,
};

/**
 * HTTP boundary for UC2-04 Commit to Session. Authenticates, validates the
 * body with Zod, and delegates to CommitToSession. The fund lock and the
 * commitment are written in one unit of work inside the use case, keyed by
 * the required idempotency key; this handler performs no writes itself.
 */
export async function handleCommitToSession(
  request: Request,
  dependencies: CommitToSessionHttpDependencies,
): Promise<Response> {
  let userId: UUID | null;
  try {
    userId = await dependencies.authenticate(request);
  } catch {
    return internalErrorResponse();
  }
  if (userId === null) {
    return errorResponse(401, "UNAUTHENTICATED", "Authentication is required");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return error instanceof SyntaxError
      ? errorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON")
      : internalErrorResponse();
  }

  let input: ReturnType<typeof parseCommitToSessionInput>;
  try {
    input = parseCommitToSessionInput(userId, body);
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(400, "INVALID_REQUEST", "Invalid commitment request")
      : internalErrorResponse();
  }

  try {
    const result = await dependencies.commitToSession.forParticipant(input);
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
