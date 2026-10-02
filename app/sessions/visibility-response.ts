import { DomainError } from "@/domain";
import { isRequestFailure } from "@/app/http/request-failure";
import { SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE, SessionManagementUnavailableError } from "./session-management-unavailable";

const domainStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 400,
  INACTIVE_ACCOUNT: 403,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  CAPACITY_EXCEEDED: 409,
  SESSION_STARTED: 409,
  SESSION_CLOSED: 409,
};

/** Shared safe failure classification for HTTP and server-action boundaries. */
export function sessionVisibilityFailure(error: unknown): { status: number; code: string; message: string } {
  if (isRequestFailure(error)) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof SessionManagementUnavailableError)
    return { status: 503, code: "SESSION_MANAGEMENT_UNAVAILABLE", message: SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE };
  if (error instanceof DomainError) {
    const status = domainStatuses[error.code];
    if (status !== undefined) return { status, code: error.code, message: error.message };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" };
}

export function sessionVisibilityErrorResponse(error: unknown): Response {
  const { status, code, message } = sessionVisibilityFailure(error);
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
