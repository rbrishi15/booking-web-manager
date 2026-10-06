import { DomainError } from "@/domain";
import { LedgerError } from "@/lib/money/errors";
import { ParticipantRemovalConflict } from "@/use-cases/sessions/participant-removal-preview";
import { sessionVisibilityFailure } from "./visibility-response";
import { SESSION_REMOVAL_UNAVAILABLE_MESSAGE, SessionRemovalUnavailableError } from "./removal-unavailable";

/** Exposes actionable conflicts while keeping infrastructure and ledger contradictions opaque. */
export function participantRemovalFailure(error: unknown) {
  if (error instanceof SessionRemovalUnavailableError)
    return { status: 503, code: "SESSION_REMOVAL_UNAVAILABLE", message: SESSION_REMOVAL_UNAVAILABLE_MESSAGE };
  if (error instanceof ParticipantRemovalConflict) return { status: 409, code: error.code, message: error.message };
  if (error instanceof DomainError && error.code === "INVALID_STATE")
    return { status: 409, code: error.code, message: "This participant can no longer be removed." };
  if (error instanceof LedgerError && ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_FLIGHT"].includes(error.code))
    return { status: 409, code: error.code, message: error.code === "IDEMPOTENCY_CONFLICT"
      ? "This request key was already used for another removal."
      : "Removal is still processing. Retry the same request." };
  return sessionVisibilityFailure(error);
}

export function participantRemovalErrorResponse(error: unknown): Response {
  const { status, code, message } = participantRemovalFailure(error);
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
