import { DomainError } from "@/domain";
import { DISCOVERY_API_UNAVAILABLE_MESSAGE, DiscoveryApiUnavailableError } from "./discovery-api-unavailable";

export function discoveryJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function discoveryError(status: number, code: string, message: string): Response {
  return discoveryJson({ error: { code, message } }, status);
}

export function discoveryInternalError(): Response {
  return discoveryError(500, "INTERNAL_ERROR", "Internal server error");
}

export function discoveryErrorResponse(error: unknown): Response {
  if (error instanceof DiscoveryApiUnavailableError)
    return discoveryError(503, "DISCOVERY_API_UNAVAILABLE", DISCOVERY_API_UNAVAILABLE_MESSAGE);
  if (error instanceof DomainError) {
    if (error.code === "INACTIVE_ACCOUNT") return discoveryError(403, error.code, error.message);
    if (error.code === "NOT_FOUND") return discoveryError(404, error.code, error.message);
  }
  return discoveryInternalError();
}
