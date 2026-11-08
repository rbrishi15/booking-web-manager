import { createAuthenticatedActions } from "@/app/http/authenticated-action";
import { DomainError } from "@/domain";
import { getSessionEditingDependencies } from "./editing-server-dependencies";
import { sessionVisibilityErrorResponse } from "./visibility-response";

function errorResponse(error: unknown) {
  if (error instanceof DomainError && (error.code === "STALE_SESSION" || error.code === "SESSION_DETAILS_LOCKED"))
    return Response.json({ error: { code: error.code, message: error.message } }, { status: 409, headers: { "Cache-Control": "no-store" } });
  return sessionVisibilityErrorResponse(error);
}

export const sessionEditingActions = createAuthenticatedActions({ getDependencies: getSessionEditingDependencies, errorResponse });
