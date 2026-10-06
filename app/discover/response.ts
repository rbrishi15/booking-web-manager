import { isRequestFailure } from "@/app/http/request-failure";
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
  if (isRequestFailure(error))
    return discoveryError(error.status, error.code, error.message);
  if (error instanceof DiscoveryApiUnavailableError)
    return discoveryError(503, "DISCOVERY_API_UNAVAILABLE", DISCOVERY_API_UNAVAILABLE_MESSAGE);
  return discoveryInternalError();
}
