import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain";
import { sessionVisibilityFailure } from "@/app/sessions/visibility-response";
import { isRequestFailure } from "@/app/http/request-failure";
import { DISCOVERY_API_UNAVAILABLE_MESSAGE, DiscoveryApiUnavailableError } from "./discovery-api-unavailable";
import { discoveryErrorDiagnostics } from "./error-diagnostics";

export type DiscoveryFailureStage = "initialization" | "authentication" | "validation" | "query" | "serialization";

const databaseMessages = {
  DATABASE_UNAVAILABLE: "The sessions database could not be reached or is temporarily unavailable. Retry shortly; if this persists, check database connectivity.",
  DATABASE_ACCESS_DENIED: "The server could not access the sessions database. Check the deployment's database credentials and permissions.",
  DATABASE_SCHEMA_MISMATCH: "The sessions database schema does not match this deployment. Check that database migrations have been applied.",
};

// The primary explanation is fixed; allowlisted diagnostics are added separately.
const databaseReasons = new Map<string, keyof typeof databaseMessages>([
  ["ECONNREFUSED", "DATABASE_UNAVAILABLE"],
  ["ECONNRESET", "DATABASE_UNAVAILABLE"],
  ["ETIMEDOUT", "DATABASE_UNAVAILABLE"],
  ["ENOTFOUND", "DATABASE_UNAVAILABLE"],
  ["EAI_AGAIN", "DATABASE_UNAVAILABLE"],
  ["08001", "DATABASE_UNAVAILABLE"],
  ["08006", "DATABASE_UNAVAILABLE"],
  ["53300", "DATABASE_UNAVAILABLE"],
  ["57P01", "DATABASE_UNAVAILABLE"],
  ["57P03", "DATABASE_UNAVAILABLE"],
  ["28P01", "DATABASE_ACCESS_DENIED"],
  ["28000", "DATABASE_ACCESS_DENIED"],
  ["42501", "DATABASE_ACCESS_DENIED"],
  ["42P01", "DATABASE_SCHEMA_MISMATCH"],
  ["42703", "DATABASE_SCHEMA_MISMATCH"],
  ["42883", "DATABASE_SCHEMA_MISMATCH"],
]);

const stageMessages: Record<DiscoveryFailureStage, string> = {
  initialization: "Session discovery could not initialize. Check the deployment configuration and server logs using the request ID.",
  authentication: "Session discovery could not authenticate this request. Retry shortly or check server logs using the request ID.",
  validation: "Session discovery could not process the request. Check server logs using the request ID.",
  query: "Session discovery could not load sessions. Retry shortly; if this persists, check server logs using the request ID.",
  serialization: "Session discovery could not prepare the response. Check server logs using the request ID.",
};

/** Classify known database causes without putting their raw messages in the primary error. */
function failureDetails(error: unknown, stage: DiscoveryFailureStage) {
  // Setup/transaction wrappers retain the actual driver error as their cause.
  const seen = new Set<object>();
  let cause = error;
  while (cause !== null && typeof cause === "object" && !seen.has(cause) && seen.size < 8) {
    seen.add(cause);
    const reason = "code" in cause && typeof cause.code === "string"
      ? databaseReasons.get(cause.code)
      : undefined;
    if (reason) return { reason, message: databaseMessages[reason] };
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return {
    reason: stage === "initialization" ? "INITIALIZATION_FAILED" : "UNEXPECTED_ERROR",
    message: stageMessages[stage],
  };
}

/** Prevent caching for every discovery result, including failures. */
export function discoveryJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Preserve the ordinary request/unavailable error contract. */
export function discoveryError(status: number, code: string, message: string): Response {
  return discoveryJson({ error: { code, message } }, status);
}

/** Correlate private error logs with fixed, allowlisted public diagnostics. */
function discoveryInternalError(error: unknown, stage: DiscoveryFailureStage): Response {
  const requestId = randomUUID();
  const { reason, message } = failureDetails(error, stage);
  console.error("Session discovery failed", {
    requestId, method: "GET", path: "/api/sessions", stage, reason, error,
  });
  return Response.json({ error: {
    code: "INTERNAL_ERROR", message, requestId, reason, stage,
    diagnostics: discoveryErrorDiagnostics(error),
  } }, {
    status: 500,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}

/** Keep expected request failures distinct from unexpected infrastructure failures. */
export function discoveryErrorResponse(error: unknown, stage: DiscoveryFailureStage): Response {
  if (stage === "authentication" && error instanceof DomainError) {
    const failure = sessionVisibilityFailure(error);
    if (failure.status !== 500) return discoveryError(failure.status, failure.code, failure.message);
  }
  if (isRequestFailure(error))
    return discoveryError(error.status, error.code, error.message);
  if (error instanceof DiscoveryApiUnavailableError)
    return discoveryError(503, "DISCOVERY_API_UNAVAILABLE", DISCOVERY_API_UNAVAILABLE_MESSAGE);
  return discoveryInternalError(error, stage);
}
