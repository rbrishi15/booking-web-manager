import { isRequestFailure } from "@/app/http/request-failure";
import { errorResponse, internalErrorResponse } from "./http";
import { PushNotificationsUnavailableError } from "./push-subscription-dependencies";

/** Maps a subscription failure to a safe, uncached JSON error. */
export function pushSubscriptionErrorResponse(error: unknown): Response {
  if (isRequestFailure(error)) return errorResponse(error.status, error.code, error.message);
  if (error instanceof PushNotificationsUnavailableError)
    return errorResponse(503, "PUSH_UNAVAILABLE", error.message);
  return internalErrorResponse();
}
