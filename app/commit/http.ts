import { DomainError, type UUID } from "@/domain";
import { z } from "zod";

/** Resolves the verified user ID for a request, or null when signed out. */
export type Authenticate = (request: Request) => Promise<UUID | null>;

export const uuid = z.string().uuid();
export const idempotencyKey = z
  .string()
  .refine((key) => key.trim() !== "", {
    message: "An idempotency key is required",
  });

const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 422,
  DUPLICATE_ID: 422,
  UNAUTHORIZED: 403,
  INACTIVE_ACCOUNT: 403,
  INVALID_ACCESS: 403,
  LOW_RELIABILITY: 403,
  NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 409,
  ALREADY_PARTICIPATING: 409,
  REJOIN_NOT_ALLOWED: 409,
  INVALID_STATE: 409,
  INVALID_INVITATION: 409,
  CAPACITY_EXCEEDED: 409,
  SESSION_CLOSED: 409,
  SESSION_STARTED: 409,
  SESSION_NOT_ENDED: 409,
  ATTENDANCE_CONFLICT: 409,
};

export interface AuthenticatedJsonAction<Input, Output> {
  readonly authenticate: Authenticate;
  /** Validates the body and combines it with the authenticated user ID. */
  readonly parse: (userId: UUID, body: unknown) => Input;
  readonly run: (input: Input) => Promise<Output>;
  readonly successStatus: number;
  readonly invalidRequestMessage: string;
}

/**
 * Shared HTTP boundary for commitment actions: authenticate, parse JSON,
 * validate with Zod, run the use case, and map the outcome to a response.
 * The acting user always comes from authentication, never the body. Known
 * domain errors become 4xx responses with their code; anything else becomes
 * an opaque 500 so internal details never reach the client.
 */
export async function handleAuthenticatedJson<Input, Output>(
  request: Request,
  action: AuthenticatedJsonAction<Input, Output>,
): Promise<Response> {
  let userId: UUID | null;
  try {
    userId = await action.authenticate(request);
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

  let input: Input;
  try {
    input = action.parse(userId, body);
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(400, "INVALID_REQUEST", action.invalidRequestMessage)
      : internalErrorResponse();
  }

  try {
    const result = await action.run(input);
    return Response.json(result, { status: action.successStatus });
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
