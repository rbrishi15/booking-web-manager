import { DomainError } from "@/domain";
import { isRequestFailure } from "@/app/http/request-failure";
import type { UserSummary } from "@/use-cases/accounts/user-handles";
import { USER_HANDLES_UNAVAILABLE_MESSAGE, UserHandlesUnavailableError } from "./user-handle-dependencies";

const domainStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
};

/** Maps a lookup failure to a safe status, code and message. */
export function userLookupFailure(error: unknown): { status: number; code: string; message: string } {
  if (isRequestFailure(error)) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof UserHandlesUnavailableError)
    return { status: 503, code: "USER_IDS_UNAVAILABLE", message: USER_HANDLES_UNAVAILABLE_MESSAGE };
  if (error instanceof DomainError) {
    const status = domainStatuses[error.code];
    if (status !== undefined) return { status, code: error.code, message: error.message };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" };
}

/** A non-cacheable JSON error response; infrastructure details stay opaque. */
export function userLookupErrorResponse(error: unknown): Response {
  const { status, code, message } = userLookupFailure(error);
  if (status === 500) console.error("User ID lookup failed:", error);
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** The public projection of a found player. */
export function toUserLookupResponse(user: UserSummary) {
  return { user: { userId: user.userId, handle: user.handle, displayName: user.displayName } };
}
