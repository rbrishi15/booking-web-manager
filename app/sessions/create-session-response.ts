import { DomainError } from "@/domain";
import {
  SESSION_API_UNAVAILABLE_MESSAGE,
  SessionApiUnavailableError,
} from "./session-api-unavailable";

const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 422,
  INACTIVE_ACCOUNT: 403,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  PAYOUT_ACCOUNT_NOT_READY: 409,
  SESSION_STARTED: 409,
};

export function sessionCreationErrorResponse(error: unknown): Response {
  if (error instanceof SessionApiUnavailableError) {
    return errorResponse(503, "SESSION_API_UNAVAILABLE", SESSION_API_UNAVAILABLE_MESSAGE);
  }
  if (error instanceof DomainError) {
    const status = domainErrorStatuses[error.code];
    if (status !== undefined) {
      return errorResponse(status, error.code, error.message);
    }
  }
  return internalErrorResponse();
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function internalErrorResponse(): Response {
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
}
