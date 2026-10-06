import { LedgerError } from "@/lib/money/errors";
import { CancellationConflict } from "@/use-cases/sessions/cancellation-preview";
import { sessionVisibilityFailure } from "./visibility-response";

/** Exposes only conflicts the caller can resolve; financial contradictions stay opaque. */
export function sessionCancellationFailure(error: unknown) {
  if (error instanceof CancellationConflict) return { status: 409, code: error.code, message: error.message };
  if (error instanceof LedgerError && ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_FLIGHT"].includes(error.code))
    return { status: 409, code: error.code, message: error.code === "IDEMPOTENCY_CONFLICT"
      ? "This request key was already used for another cancellation."
      : "Cancellation is still processing. Retry the same request." };
  return sessionVisibilityFailure(error);
}

export function sessionCancellationErrorResponse(error: unknown): Response {
  const { status, code, message } = sessionCancellationFailure(error);
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
